import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseScenario, type Report } from '@fastforward/contracts';
import type { AiClient } from '@fastforward/ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, scenarioToYaml } from '../src/index.js';

let dir: string;
let servers: http.Server[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-cli-'));
  servers = [];
});
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  rmSync(dir, { recursive: true, force: true });
});

async function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as AddressInfo).port;
}

/** A port nothing listens on: open one, note it, close it. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

/** A minimal PayPal-integrated app: answers webhooks 200 and, if `verify`, asks the twin to verify each one. */
async function startApp(twinPort: number, verify: boolean): Promise<string> {
  const port = await listen((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      if (verify && req.method === 'POST') {
        await fetch(`http://127.0.0.1:${twinPort}/v1/notifications/verify-webhook-signature`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            transmission_id: req.headers['paypal-transmission-id'],
            transmission_time: req.headers['paypal-transmission-time'],
            cert_url: req.headers['paypal-cert-url'],
            auth_algo: req.headers['paypal-auth-algo'],
            transmission_sig: req.headers['paypal-transmission-sig'],
            webhook_id: 'WH-FF-LOCAL',
            webhook_event: JSON.parse(Buffer.concat(chunks).toString()),
          }),
        });
      }
      res.statusCode = 200;
      res.end('ok');
    });
  });
  return `http://127.0.0.1:${port}/webhooks/paypal`;
}

const scenarioYaml = (webhookUrl: string, extra = '') => `
name: tiny
seed: 7
start: 2026-11-01T00:00:00.000Z
duration: P3D
app:
  webhookUrl: ${webhookUrl}
plan:
  name: Tiny
  price: "5.00"
  currency: USD
  interval: MONTH
customers:
  - name: Sam
    persona: Easygoing.
    card: ok
${extra}`;

interface Out {
  out: string;
  err: string;
}
function capture(): Out & { io: { stdout: (s: string) => void; stderr: (s: string) => void } } {
  const c = { out: '', err: '', io: { stdout: (s: string) => void (c.out += s), stderr: (s: string) => void (c.err += s) } };
  return c;
}

describe('fastforward run', () => {
  it("exits 2 with can't reach your app when nothing listens (within 5 s)", async () => {
    const url = `http://127.0.0.1:${await closedPort()}/webhooks/paypal`;
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(url));
    const c = capture();
    const t0 = Date.now();
    const code = await main(['run', file, '--twin-port', '0', '--report-dir', join(dir, 'out')], c.io);
    expect(code).toBe(2);
    expect(c.err).toContain(`can't reach your app at ${url}`);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(existsSync(join(dir, 'out'))).toBe(false); // no report full of failed checks
  });

  it('exits 1 when a check fails and prints the plain-language finding, the report path and the dashboard link', async () => {
    const twinPort = await closedPort();
    const app = await startApp(twinPort, false); // never verifies signatures
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(app));
    const c = capture();
    const code = await main(['run', file, '--twin-port', String(twinPort), '--report-dir', join(dir, 'out')], c.io);
    expect(code).toBe(1);
    expect(c.out).toContain('VERIFIES_SIGNATURES');
    expect(c.out).toMatch(/Fix:/);
    expect(c.out).toMatch(/http:\/\/localhost:5173\/\?run=run-[0-9a-f]{8}/);
    const report = JSON.parse(readFileSync(join(dir, 'out', 'report.json'), 'utf8')) as Report;
    expect(report.checks.find((x) => x.id === 'VERIFIES_SIGNATURES')?.status).toBe('fail');
    expect(report.checks.find((x) => x.id === 'VERIFIES_SIGNATURES')?.findings[0]?.fix).toBeTruthy();
  });

  it('exits 0 when every check passes or is skipped', async () => {
    const twinPort = await closedPort();
    const app = await startApp(twinPort, true);
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(app));
    const c = capture();
    const code = await main(['run', file, '--twin-port', String(twinPort), '--report-dir', join(dir, 'out')], c.io);
    expect(c.err).toBe('');
    expect(code).toBe(0);
    const report = JSON.parse(readFileSync(join(dir, 'out', 'report.json'), 'utf8')) as Report;
    expect(report.checks.every((x) => x.status !== 'fail')).toBe(true);
  });

  it('uses the AI narrator for failing findings when an AI is given', async () => {
    const twinPort = await closedPort();
    const app = await startApp(twinPort, false);
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(app));
    const ai: AiClient = { complete: async () => '{"explanation":"Narrated by the model.","fix":"Do the thing."}' };
    const c = capture();
    await main(['run', file, '--twin-port', String(twinPort), '--report-dir', join(dir, 'out')], { ...c.io, ai });
    expect(c.out).toContain('Narrated by the model.');
  });

  it('--fresh removes the lock file, and a run without it keeps it', async () => {
    const twinPort = await closedPort();
    const app = await startApp(twinPort, true);
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(app));
    const lock = join(dir, 'tiny.lock.json');
    writeFileSync(lock, JSON.stringify({ 'Sam:payment_failed:1': { action: 'cancel' } }));

    await main(['run', file, '--twin-port', String(twinPort), '--report-dir', join(dir, 'a')], capture().io);
    expect(existsSync(lock)).toBe(true);

    await main(['run', file, '--fresh', '--twin-port', String(twinPort), '--report-dir', join(dir, 'b')], capture().io);
    expect(existsSync(lock)).toBe(false);
  });

  it('exits 2 for a missing file and for an invalid scenario, naming the problem', async () => {
    const c1 = capture();
    expect(await main(['run', join(dir, 'nope.yaml')], c1.io)).toBe(2);
    expect(c1.err).toContain('nope.yaml');

    const bad = join(dir, 'bad.yaml');
    writeFileSync(bad, 'name: broken\n');
    const c2 = capture();
    expect(await main(['run', bad], c2.io)).toBe(2);
    expect(c2.err).toContain('invalid scenario');
    expect(c2.err).toContain('bad.yaml');
  });
});

describe('fastforward new', () => {
  const fakeAi = (yaml: string): AiClient => ({ complete: async () => yaml });
  const goodYaml = scenarioYaml('http://127.0.0.1:3000/webhooks/paypal');

  it('writes YAML from a description', async () => {
    const out = join(dir, 'made.yaml');
    const c = capture();
    const code = await main(['new', 'a tiny month', '-o', out], { ...c.io, ai: fakeAi(goodYaml) });
    expect(code).toBe(0);
    expect(parseScenario(readFileSync(out, 'utf8')).name).toBe('tiny');
    expect(c.out).toContain(out);
  });

  it('prints a clear error and exits 2 without an AI', async () => {
    const c = capture();
    const code = await main(['new', 'a tiny month', '-o', join(dir, 'x.yaml')], { ...c.io, ai: null });
    expect(code).toBe(2);
    expect(c.err).toContain('set ANTHROPIC_API_KEY or write the YAML by hand');
    expect(existsSync(join(dir, 'x.yaml'))).toBe(false);
  });

  it('does not overwrite an existing file', async () => {
    const out = join(dir, 'made.yaml');
    writeFileSync(out, 'keep me');
    const c = capture();
    expect(await main(['new', 'a tiny month', '-o', out], { ...c.io, ai: fakeAi(goodYaml) })).toBe(2);
    expect(readFileSync(out, 'utf8')).toBe('keep me');
  });
});

describe('scenarioToYaml', () => {
  it('round-trips through parseScenario', () => {
    const original = parseScenario(readFileSync(new URL('../../../examples/coffee-club/scenarios/bad-month.yaml', import.meta.url), 'utf8'));
    expect(parseScenario(scenarioToYaml(original))).toEqual(original);
  });
});

describe('usage', () => {
  it('prints help and exits 2 for an unknown command', async () => {
    const c = capture();
    expect(await main(['wat'], c.io)).toBe(2);
    expect(c.err).toContain('fastforward run');
  });
});

describe('formatReport', () => {
  const finding = (n: number) => ({ at: '2026-11-01T00:00:00.000Z', summary: `Notice ${n} was accepted unchecked`, eventIds: [`E${n}`], explanation: 'Same explanation.', fix: 'Same fix.' });
  const report: Report = {
    runId: 'run-1',
    scenario: 's',
    start: '2026-11-01T00:00:00.000Z',
    end: '2026-12-01T00:00:00.000Z',
    checks: [
      { id: 'ACK_FAST', status: 'pass', findings: [] },
      { id: 'VERIFIES_SIGNATURES', status: 'fail', findings: [1, 2, 3, 4, 5].map(finding) },
      { id: 'STATE_MATCHES', status: 'skipped', findings: [], note: 'no probeUrl' },
    ],
    counts: { events: 5, deliveries: 5, customers: 1 },
  };

  it('lists each finding, says the explanation and fix once, and counts the rest', async () => {
    const { formatReport } = await import('../src/index.js');
    const text = formatReport(report, { reportDir: 'out', dashboardLink: 'http://localhost:5173/?run=run-1', twinKept: true });
    expect(text.match(/Same explanation\./g)).toHaveLength(1);
    expect(text.match(/Fix: Same fix\./g)).toHaveLength(1);
    expect(text).toContain('Notice 3 was accepted unchecked');
    expect(text).not.toContain('Notice 4');
    expect(text).toContain('… and 2 more');
    expect(text).toContain('1 of 3 checks failed');
    expect(text).toContain('(no probeUrl)');
    expect(text).toContain('Dashboard: http://localhost:5173/?run=run-1');
    expect(text).not.toContain('--keep-twin');
  });
});
