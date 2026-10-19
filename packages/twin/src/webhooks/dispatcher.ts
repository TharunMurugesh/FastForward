import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type { TraceEntry, WebhookEvent } from '@fastforward/contracts';
import { fidelity } from '../fidelity.js';
import type { VirtualClock } from '../time/clock.js';
import type { Scheduler } from '../time/scheduler.js';
import { certUrl, signingString, type Signer } from './sign.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface DeliveryPolicy {
  firstRetryMinutes: number;
  maxAttempts: number;
  windowDays: number;
}

const defaultPolicy: DeliveryPolicy = {
  firstRetryMinutes: fidelity.deliveryFirstRetryMinutes,
  maxAttempts: fidelity.deliveryMaxAttempts,
  windowDays: fidelity.deliveryWindowDays,
};

/**
 * When the next attempt is due after `attemptsMade` failures, or null when PayPal would give up.
 * The wait starts at `firstRetryMinutes` and doubles; both the attempt cap and the window apply.
 */
export function nextAttemptAt(firstAttempt: Date, attemptsMade: number, policy: DeliveryPolicy = defaultPolicy): Date | null {
  if (attemptsMade >= policy.maxAttempts) return null;
  // Attempt n+1 lands at first + (2^n - 1) × firstRetry: 1, 3, 7, 15 … minutes after the first.
  const at = firstAttempt.getTime() + (2 ** attemptsMade - 1) * policy.firstRetryMinutes * MINUTE;
  return at - firstAttempt.getTime() <= policy.windowDays * DAY ? new Date(at) : null;
}

/** Which deliveries the app checked: by calling the verify endpoint, or by fetching the cert. */
export class VerifyLedger {
  private readonly verified = new Set<string>();
  private lastCertFetch = Number.NEGATIVE_INFINITY;

  mark(transmissionId: string): void {
    this.verified.add(transmissionId);
  }

  markCertFetch(): void {
    this.lastCertFetch = Date.now();
  }

  /** `sinceMs` is real (wall-clock) time when the delivery began; the app answers in real time. */
  wasVerified(transmissionId: string, sinceMs: number): boolean {
    return this.verified.has(transmissionId) || this.lastCertFetch >= sinceMs;
  }
}

export interface DispatcherDeps {
  scheduler: Scheduler;
  clock: VirtualClock;
  signer: Signer;
  webhookUrl: string;
  webhookId: string;
  runId: string;
  record: (t: TraceEntry) => void;
  verifyCalls: VerifyLedger;
  timeoutMs?: number;
}

/** POSTs the exact bytes with the exact header names given (fetch would lower-case them). */
function post(url: URL, headers: Record<string, string>, body: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const send = url.protocol === 'https:' ? https.request : http.request;
    const req = send(url, { method: 'POST', headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) }, signal: AbortSignal.timeout(timeoutMs) }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? null));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null)); // refused, reset or timed out: not delivered
    req.end(body);
  });
}

/** Signs and delivers webhooks to the app, retrying on PayPal's schedule in virtual time (spec §6). */
export class Dispatcher {
  private readonly deps: DispatcherDeps;
  private readonly url: URL;
  private readonly timeoutMs: number;
  private readonly recorded = new Set<string>();

  constructor(deps: DispatcherDeps) {
    this.deps = deps;
    this.url = new URL(deps.webhookUrl);
    const fromEnv = process.env.FF_DELIVERY_TIMEOUT_MS;
    this.timeoutMs = deps.timeoutMs ?? (fromEnv === undefined ? fidelity.deliveryTimeoutMs : Number(fromEnv));
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error(`FF_DELIVERY_TIMEOUT_MS must be a positive number of milliseconds, got "${fromEnv}"`);
    }
  }

  /** Delivers now (attempt 1); failures schedule retries. Records the event once, then one entry per attempt. */
  async send(event: WebhookEvent, opts: { forged?: boolean } = {}): Promise<void> {
    const forged = opts.forged ?? false;
    if (!this.recorded.has(event.id)) {
      this.recorded.add(event.id);
      this.deps.record({ at: this.deps.clock.now().toISOString(), kind: 'event', event, forged });
    }
    await this.attempt(event, forged, 1, this.deps.clock.now());
  }

  scheduleSend(event: WebhookEvent, at: Date, opts: { forged?: boolean } = {}): void {
    this.deps.scheduler.schedule(at, `deliver ${event.event_type} ${event.id}`, () => this.send(event, opts));
  }

  private async attempt(event: WebhookEvent, forged: boolean, attempt: number, firstAttempt: Date): Promise<void> {
    const { clock, signer, webhookId, runId, verifyCalls, record, scheduler } = this.deps;
    const transmissionId = randomUUID();
    const transmissionTime = clock.now().toISOString();
    const body = JSON.stringify(event);
    const signed = signingString(transmissionId, transmissionTime, webhookId, body);
    // A forged event points at the genuine cert, but its signature covers different bytes, so it fails.
    const sig = signer.sign(forged ? `${signed}|forged` : signed);

    const started = Date.now();
    const status = await post(
      this.url,
      {
        'Content-Type': 'application/json',
        'PAYPAL-AUTH-ALGO': 'SHA256withRSA',
        'PAYPAL-CERT-URL': certUrl(signer.certId),
        'PAYPAL-TRANSMISSION-ID': transmissionId,
        'PAYPAL-TRANSMISSION-SIG': sig,
        'PAYPAL-TRANSMISSION-TIME': transmissionTime,
        'X-Fastforward-Run': runId,
      },
      body,
      this.timeoutMs,
    );
    const ms = Date.now() - started;
    record({
      at: transmissionTime,
      kind: 'delivery',
      eventId: event.id,
      attempt,
      status,
      ms,
      verifyCalled: verifyCalls.wasVerified(transmissionId, started),
      transmissionId,
    });

    if (status !== null && status >= 200 && status < 300) return;
    const next = nextAttemptAt(firstAttempt, attempt);
    if (next) {
      scheduler.schedule(next, `retry ${event.id} #${attempt + 1}`, () => this.attempt(event, forged, attempt + 1, firstAttempt));
    }
  }
}
