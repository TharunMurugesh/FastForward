import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
 * (`FASTFORWARD=1 node --import @fastforward/register`), against the real twin, driven by the real CLI runner.
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
async function runAgainstCoffeeClub(bugs: string): Promise<Report & { trace: TraceEntry[] }> {
  const appPort = await freePort();
  const twinPort = await freePort();
  child = spawn(process.execPath, ['--import', '@fastforward/register', 'examples/coffee-club/dist/server.js'], {
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

  const file = join(dir, `bad-month-${bugs.replace(/[^a-z-]+/g, '_')}.yaml`);
  writeFileSync(file, scenario(appPort));
  const result = await runScenarioFile(file, { twinPort, ai: null, reportDir: join(dir, `report-${bugs.replace(/[^a-z-]+/g, '_')}`) });
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
