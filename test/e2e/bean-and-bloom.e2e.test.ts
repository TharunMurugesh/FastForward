import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CheckId, Report } from '@fastforward/contracts';
import { runScenarioFile } from '@fastforward/cli';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

/**
 * E2E: Bean & Bloom, the shop from the demo video, exactly as committed. It has no bug switch; it was written as an
 * ordinary shop with one check left out (repeated notices). Fastforward must find that one, and only that one, and the
 * shop must pass once the fix from its README is added.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOP = join(ROOT, 'examples/bean-and-bloom');
const FIXED = join(SHOP, 'server.fixed.e2e.js');

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
    if (child.exitCode !== null) throw new Error(`Bean & Bloom exited early with code ${child.exitCode}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('Bean & Bloom did not start within 20 s');
}

let dir: string;
let child: ChildProcess | null = null;
const saved = { timeout: process.env.FF_DELIVERY_TIMEOUT_MS };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-e2e-bloom-'));
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
  rmSync(FIXED, { force: true });
});

async function runAgainst(serverFile: string, key: string): Promise<Report> {
  const appPort = await freePort();
  const twinPort = await freePort();
  child = spawn(process.execPath, ['--import', 'fastforward-register', serverFile], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      FASTFORWARD: '1',
      FF_TWIN_URL: `http://127.0.0.1:${twinPort}`,
      PORT: String(appPort),
      PAYPAL_CLIENT_ID: 'ff-e2e',
      PAYPAL_CLIENT_SECRET: 'ff-e2e',
      ANTHROPIC_API_KEY: '',
    },
  });
  await waitUntilUp(`http://127.0.0.1:${appPort}/__ff/probe?subscription_id=none`, child);
  const file = join(dir, `bad-month-${key}.yaml`);
  writeFileSync(file, readFileSync(join(SHOP, 'scenarios/bad-month.yaml'), 'utf8').replaceAll('127.0.0.1:3001', `127.0.0.1:${appPort}`));
  return (await runScenarioFile(file, { twinPort, ai: null, reportDir: join(dir, `report-${key}`) })).report;
}

const statusOf = (report: Report, id: CheckId) => report.checks.find((c) => c.id === id)?.status;

describe('Bean & Bloom against the twin', () => {
  it('as committed: only the forgotten repeat check fails (Paid twice)', async () => {
    const report = await runAgainst(join(SHOP, 'server.js'), 'as-committed');
    expect(report.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['FULFIL_ONCE']);
    expect(statusOf(report, 'NO_LIVE_CALLS')).toBe('pass');
  });

  it('with the repeat check from the README added: all six checks pass', async () => {
    const source = readFileSync(join(SHOP, 'server.js'), 'utf8');
    const fixed = source
      .replace('const members = {};', 'const members = {};\nconst seen = new Set();')
      .replace('return res.sendStatus(400);', 'return res.sendStatus(400);\n  if (seen.has(event.id)) return res.sendStatus(200);\n  seen.add(event.id);');
    expect(fixed).not.toBe(source);
    writeFileSync(FIXED, fixed);
    const report = await runAgainst(FIXED, 'fixed');
    const failing = report.checks.filter((c) => c.status === 'fail');
    expect(failing.map((c) => ({ id: c.id, findings: c.findings.slice(0, 3).map((f) => f.summary) }))).toEqual([]);
    expect(report.checks).toHaveLength(6);
  });
});
