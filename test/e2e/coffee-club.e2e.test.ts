import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckId, Report, TraceEntry } from '@fastforward/contracts';
import { runScenarioFile } from '@fastforward/cli';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * Phase 1 acceptance: the real Coffee Club app, started the way a user would start their own
 * (`FASTFORWARD=1 node --import fastforward-register`), against the real twin, driven by the real CLI runner.
 * Nothing here touches live PayPal or the Anthropic API: the register add-on sends the app's PayPal
 * calls to the twin, and the run uses no AI (scripted customers, template narration).
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// bad-month without weather and without Ana's dispute (those arrive with the dispute and weather tasks).
const scenario = (appPort: number) => `
name: bad-month-phase1
seed: 42
start: 2026-11-01T00:00:00.000Z
duration: P60D
app:
  webhookUrl: http://127.0.0.1:${appPort}/webhooks/paypal
  subscribeUrl: http://127.0.0.1:${appPort}/subscribe
  probeUrl: http://127.0.0.1:${appPort}/__ff/probe
plan:
  name: Coffee Club Monthly
  price: "12.00"
  currency: USD
  interval: MONTH
  # With PayPal's documented retry rules a failure only counts once both retries fail, so the default
  # threshold of 2 would not suspend Leo inside 60 days. Threshold 1 suspends him on his first failure.
  paymentFailureThreshold: 1
customers:
  - name: Maya
    persona: Pays on time and never complains.
    card: ok
  - name: Leo
    persona: Busy, rarely reads email, card expires in December.
    card: fails_from:2026-12-01
  - name: Ana
    persona: Pays on time.
    card: ok
`;

async function freePort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

async function waitUntilUp(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Coffee Club exited early with code ${child.exitCode}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('Coffee Club did not start within 20 s');
}

let dir: string;
let child: ChildProcess | null = null;
const saved = { timeout: process.env.FF_DELIVERY_TIMEOUT_MS };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-e2e-'));
  process.env.FF_DELIVERY_TIMEOUT_MS = '500'; // read by the in-process twin's dispatcher
});
afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((r) => child!.once('exit', r));
  }
  child = null;
});
afterAll(() => {
  if (saved.timeout === undefined) delete process.env.FF_DELIVERY_TIMEOUT_MS;
  else process.env.FF_DELIVERY_TIMEOUT_MS = saved.timeout;
  rmSync(dir, { recursive: true, force: true });
});

/** Starts Coffee Club with the given bugs, runs bad-month against it, returns the report. */
async function runAgainstCoffeeClub(bugs: string, makeScenario: (appPort: number) => string = scenario, tag = 'phase1'): Promise<Report & { trace: TraceEntry[] }> {
  const appPort = await freePort();
  const twinPort = await freePort();
  child = spawn(process.execPath, ['--import', 'fastforward-register', 'examples/coffee-club/dist/server.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      FASTFORWARD: '1',
      FF_TWIN_URL: `http://127.0.0.1:${twinPort}`,
      PORT: String(appPort),
      COFFEE_BUGS: bugs,
      COFFEE_SLOW_MS: '1000',
      FF_AI: 'off',
      // Placeholders: the twin accepts any credentials, and these keep any real ones out of the child.
      PAYPAL_CLIENT_ID: 'ff-e2e',
      PAYPAL_CLIENT_SECRET: 'ff-e2e',
      ANTHROPIC_API_KEY: '',
    },
  });
  await waitUntilUp(`http://127.0.0.1:${appPort}/__ff/probe?subscription_id=none`, child);

  const key = `${tag}-${bugs.replace(/[^a-z-]+/g, '_')}`;
  const file = join(dir, `bad-month-${key}.yaml`);
  writeFileSync(file, makeScenario(appPort));
  const result = await runScenarioFile(file, { twinPort, ai: null, reportDir: join(dir, `report-${key}`) });
  return { ...result.report, trace: result.trace };
}

const statusOf = (report: Report, id: CheckId) => report.checks.find((c) => c.id === id)?.status;

describe('Phase 1 acceptance: Coffee Club against the twin', () => {
  it('COFFEE_BUGS=none: every check passes or is skipped, and the run really exercised the app', async () => {
    const report = await runAgainstCoffeeClub('none');
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([]);
    // Not vacuous: payments happened, the app was probed and verified signatures.
    expect(report.counts.deliveries).toBeGreaterThan(10);
    for (const id of ['ACK_FAST', 'VERIFIES_SIGNATURES', 'STATE_MATCHES', 'FULFIL_ONCE'] as const) expect(statusOf(report, id)).toBe('pass');
    expect(statusOf(report, 'NO_LIVE_CALLS')).toBe('pass');
    // The hard case really happened: Leo was suspended, and the app switched his access off.
    expect(report.trace.some((t) => t.kind === 'event' && t.event.event_type === 'BILLING.SUBSCRIPTION.SUSPENDED')).toBe(true);
    expect(report.trace.some((t) => t.kind === 'probe' && !t.expectedAccess && t.access === false)).toBe(true);
  });

  it('COFFEE_BUGS=no-verify,no-dedupe,slow-ack,ignores-suspend: the four matching checks fail', async () => {
    const report = await runAgainstCoffeeClub('no-verify,no-dedupe,slow-ack,ignores-suspend');
    for (const id of ['VERIFIES_SIGNATURES', 'FULFIL_ONCE', 'ACK_FAST', 'STATE_MATCHES'] as const) {
      expect(statusOf(report, id), id).toBe('fail');
    }
    expect(statusOf(report, 'NO_LIVE_CALLS')).toBe('pass');
    // Every failure comes with plain-language help.
    for (const c of report.checks.filter((x) => x.status === 'fail')) {
      expect(c.findings[0]?.explanation, c.id).toBeTruthy();
      expect(c.findings[0]?.fix, c.id).toBeTruthy();
    }
  });
});

/**
 * Phase 2 acceptance: the committed bad-month.yaml exactly as it is (weather, Ana's dispute, 75 days, the
 * default failure threshold of 2). Only the app's port is filled in, because the file points at 3000.
 */
const committedBadMonth = (appPort: number) =>
  readFileSync(join(ROOT, 'examples/coffee-club/scenarios/bad-month.yaml'), 'utf8').replaceAll('127.0.0.1:3000', `127.0.0.1:${appPort}`);

const eventsOf = (trace: TraceEntry[], type?: string) =>
  trace.flatMap((t) => (t.kind === 'event' && (type === undefined || t.event.event_type === type) ? [t] : []));

describe('Phase 2 acceptance: the full bad-month under bad weather', () => {
  it('COFFEE_BUGS=all: five checks fail, NO_LIVE_CALLS passes', async () => {
    const report = await runAgainstCoffeeClub('all', committedBadMonth, 'phase2');
    for (const id of ['VERIFIES_SIGNATURES', 'FULFIL_ONCE', 'ACK_FAST', 'STATE_MATCHES', 'DISPUTE_ANSWERED'] as const) {
      expect(statusOf(report, id), id).toBe('fail');
    }
    expect(statusOf(report, 'NO_LIVE_CALLS')).toBe('pass');
    expect(report.checks.filter((c) => c.status === 'fail')).toHaveLength(5);
    for (const c of report.checks.filter((x) => x.status === 'fail')) {
      expect(c.findings[0]?.explanation, c.id).toBeTruthy();
      expect(c.findings[0]?.fix, c.id).toBeTruthy();
    }
  });

  it('COFFEE_BUGS=none: all six checks pass, and the run really exercised every hard case', async () => {
    const report = await runAgainstCoffeeClub('none', committedBadMonth, 'phase2');
    const failing = report.checks.filter((c) => c.status === 'fail');
    expect(failing.map((c) => ({ id: c.id, findings: c.findings.slice(0, 3).map((f) => f.summary) }))).toEqual([]);
    for (const c of report.checks) {
      // A check may skip only with a stated reason; none of the six should need to here.
      expect(c.status, `${c.id} ${c.note ?? ''}`).toBe('pass');
    }

    const { trace } = report;
    // Leo was suspended on 1 Jan, after both December retries failed, and his access was off afterwards.
    const suspended = eventsOf(trace, 'BILLING.SUBSCRIPTION.SUSPENDED').filter((e) => !e.forged);
    expect(suspended.map((e) => e.at.slice(0, 10))).toEqual(['2027-01-01']);
    const leoId = (suspended[0]!.event.resource as { id: string }).id;
    expect(trace.some((t) => t.kind === 'probe' && t.subscriptionId === leoId && t.at >= '2027-01-01' && !t.expectedAccess && t.access === false)).toBe(true);
    expect(trace.some((t) => t.kind === 'probe' && t.subscriptionId === leoId && t.at >= '2027-01-01' && t.access === true)).toBe(false);

    // Ana's dispute was answered with evidence before its deadline, so it was never resolved against the seller.
    expect(trace.some((t) => t.kind === 'dispute_action' && t.action === 'provide-evidence')).toBe(true);
    expect(eventsOf(trace, 'CUSTOMER.DISPUTE.RESOLVED')).toEqual([]);

    // Bad weather really happened: a duplicate (same event id delivered twice as first attempts) and a forged notice.
    const firstAttempts = new Map<string, number>();
    for (const t of trace) if (t.kind === 'delivery' && t.attempt === 1) firstAttempts.set(t.eventId, (firstAttempts.get(t.eventId) ?? 0) + 1);
    expect([...firstAttempts.values()].some((n) => n >= 2)).toBe(true);
    const forged = eventsOf(trace).filter((e) => e.forged);
    expect(forged).toHaveLength(1);
    const forgedDeliveries = trace.filter((t) => t.kind === 'delivery' && t.eventId === forged[0]!.event.id);
    expect(forgedDeliveries.length).toBeGreaterThan(0);
    // The fixed app rejected it: it answered the forged notice with an error after the twin said FAILURE.
    expect(trace.some((t) => t.kind === 'verify_call' && t.result === 'FAILURE' && forgedDeliveries.some((d) => d.kind === 'delivery' && d.transmissionId === t.transmissionId))).toBe(true);
  });
});
