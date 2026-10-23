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
 * E2E acceptance: Plain Fetch Shop, started with `FASTFORWARD=1 node --import fastforward-register`,
 * against the real twin, driven by the real CLI runner with plain fetch and no SDK.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

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
    if (child.exitCode !== null) throw new Error(`Plain Fetch Shop exited early with code ${child.exitCode}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('Plain Fetch Shop did not start within 20 s');
}

let dir: string;
let child: ChildProcess | null = null;
const saved = { timeout: process.env.FF_DELIVERY_TIMEOUT_MS };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-e2e-shop-'));
  process.env.FF_DELIVERY_TIMEOUT_MS = '500';
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

const committedBadMonth = (appPort: number) =>
  readFileSync(join(ROOT, 'examples/plain-fetch-shop/scenarios/bad-month.yaml'), 'utf8').replaceAll('127.0.0.1:3000', `127.0.0.1:${appPort}`);

async function runAgainstPlainFetchShop(bugs: string): Promise<Report & { trace: TraceEntry[] }> {
  const appPort = await freePort();
  const twinPort = await freePort();
  child = spawn(process.execPath, ['--import', 'fastforward-register', 'examples/plain-fetch-shop/dist/server.js'], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      FASTFORWARD: '1',
      FF_TWIN_URL: `http://127.0.0.1:${twinPort}`,
      PORT: String(appPort),
      SHOP_BUGS: bugs,
      SHOP_SLOW_MS: '1000',
      FF_AI: 'off',
      PAYPAL_CLIENT_ID: 'ff-e2e',
      PAYPAL_CLIENT_SECRET: 'ff-e2e',
      ANTHROPIC_API_KEY: '',
    },
  });
  await waitUntilUp(`http://127.0.0.1:${appPort}/__ff/probe?subscription_id=none`, child);

  const key = `plain-fetch-${bugs.replace(/[^a-z-]+/g, '_')}`;
  const file = join(dir, `bad-month-${key}.yaml`);
  writeFileSync(file, committedBadMonth(appPort));
  const result = await runScenarioFile(file, { twinPort, ai: null, reportDir: join(dir, `report-${key}`) });
  return { ...result.report, trace: result.trace };
}

const statusOf = (report: Report, id: CheckId) => report.checks.find((c) => c.id === id)?.status;

describe('Plain Fetch Shop against the twin', () => {
  it('SHOP_BUGS=no-verify,no-dedupe,ignores-suspend,ignores-disputes: at least four matching checks fail', async () => {
    const report = await runAgainstPlainFetchShop('no-verify,no-dedupe,ignores-suspend,ignores-disputes');
    for (const id of ['VERIFIES_SIGNATURES', 'FULFIL_ONCE', 'STATE_MATCHES', 'DISPUTE_ANSWERED'] as const) {
      expect(statusOf(report, id), id).toBe('fail');
    }
    expect(statusOf(report, 'NO_LIVE_CALLS')).toBe('pass');
    expect(report.checks.filter((c) => c.status === 'fail').length).toBeGreaterThanOrEqual(4);
    for (const c of report.checks.filter((x) => x.status === 'fail')) {
      expect(c.findings[0]?.explanation, c.id).toBeTruthy();
      expect(c.findings[0]?.fix, c.id).toBeTruthy();
    }
  });

  it('SHOP_BUGS=none: all six checks pass', async () => {
    const report = await runAgainstPlainFetchShop('none');
    const failing = report.checks.filter((c) => c.status === 'fail');
    expect(failing.map((c) => ({ id: c.id, findings: c.findings.slice(0, 3).map((f) => f.summary) }))).toEqual([]);
    for (const c of report.checks) {
      expect(c.status, `${c.id} ${c.note ?? ''}`).toBe('pass');
    }
    expect(statusOf(report, 'NO_LIVE_CALLS')).toBe('pass');
  });
});

