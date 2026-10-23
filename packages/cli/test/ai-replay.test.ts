import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiClient } from '@fastforward/ai';
import type { Report } from '@fastforward/contracts';
import { createTwin, type Twin } from '@fastforward/twin';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main, narrationLockPathFor, runScenarioFile } from '../src/index.js';

/**
 * Recording and replaying the model's work: a run with a model saves what it decided and wrote, and the same run
 * later with no model at all shows the same words, labelled as the model's. All with a fake model, no network.
 */

let dir: string;
const closers: (() => Promise<void>)[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-replay-'));
});
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
  rmSync(dir, { recursive: true, force: true });
});

async function listen(handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(() => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))));
  return (server.address() as AddressInfo).port;
}

async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

/** An app that answers 200 and never verifies a signature, so VERIFIES_SIGNATURES fails and there is something to explain. */
async function startApp(): Promise<string> {
  const port = await listen((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      res.statusCode = 200;
      res.end('ok');
    });
  });
  return `http://127.0.0.1:${port}/webhooks/paypal`;
}

// Sam's card fails from the first day, so there is a customer decision to make as well as checks to explain.
const scenarioYaml = (webhookUrl: string) => `
name: tiny
seed: 7
start: 2026-11-01T00:00:00.000Z
duration: P12D
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
    card: fails_from:2026-11-01
`;

/** Answers a customer prompt with a decision and anything else (the narrator) with an explanation. Counts calls. */
function fakeModel() {
  let calls = 0;
  const ai: AiClient = {
    async complete({ prompt }) {
      calls += 1;
      return prompt.includes('Customer:') ? '{"action":"update_card"}' : '{"explanation":"Written by the model.","fix":"Model fix."}';
    },
    usage: () => ({ calls, inputTokens: calls * 100, outputTokens: calls * 20 }),
  };
  return { ai, calls: () => calls };
}

function capture() {
  const c = { out: '', err: '', io: { stdout: (s: string) => void (c.out += s), stderr: (s: string) => void (c.err += s) } };
  return c;
}

const readReport = (outDir: string) => JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as Report;
// Only the first three findings of each failing check are explained (one bad habit repeats on every delivery).
const failingFindings = (r: Report) => r.checks.filter((c) => c.status === 'fail').flatMap((c) => c.findings.slice(0, 3));

async function record(file: string, twinPort: number, outDir: string, ai: AiClient | null, extra: string[] = []) {
  const c = capture();
  await main(['run', file, '--twin-port', String(twinPort), '--report-dir', outDir, ...extra], { ...c.io, ai });
  return { c, report: readReport(outDir) };
}

describe('recording and replaying the model', () => {
  it('a run with a model saves its decisions and explanations, labels them, and summarises the model use', async () => {
    const twinPort = await closedPort();
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(await startApp()));
    const { ai, calls } = fakeModel();
    const { c, report } = await record(file, twinPort, join(dir, 'a'), ai);

    expect(existsSync(join(dir, 'tiny.lock.json'))).toBe(true);
    expect(existsSync(narrationLockPathFor(file))).toBe(true);
    expect(narrationLockPathFor(file)).toBe(join(dir, 'tiny.narration.lock.json'));
    const findings = failingFindings(report);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.explanationSource === 'model' && f.explanation === 'Written by the model.')).toBe(true);
    expect(report.ai).toMatchObject({ model: 'claude-opus-5-5', calls: calls() });
    expect(report.ai!.customerDecisions.model).toBeGreaterThan(0);
    expect(report.ai!.explanations).toEqual({ model: findings.length, total: findings.length });
    expect(c.out).toContain('AI: claude-opus-5-5');
    expect(c.out).toContain(`${calls()} model calls`);
  });

  it('the same run later with no model replays the saved words and decisions, with no model calls', async () => {
    const twinPort = await closedPort();
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(await startApp()));
    await record(file, twinPort, join(dir, 'a'), fakeModel().ai);

    const { c, report } = await record(file, twinPort, join(dir, 'b'), null);
    const findings = failingFindings(report);
    expect(findings.every((f) => f.explanationSource === 'model' && f.explanation === 'Written by the model.')).toBe(true);
    expect(report.ai!.customerDecisions.model).toBeGreaterThan(0);
    expect(report.ai!.explanations.model).toBe(findings.length);
    expect(report.ai!.calls ?? 0).toBe(0);
    expect(c.out).toContain('replayed from a recording');
  });

  it('with no model and no recording, explanations are templates, labelled as such, with no ai summary', async () => {
    const twinPort = await closedPort();
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(await startApp()));
    const { c, report } = await record(file, twinPort, join(dir, 'a'), null);
    const findings = failingFindings(report);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.explanationSource === 'template' && f.explanation && f.fix)).toBe(true);
    expect(report.ai).toBeUndefined();
    expect(c.out).not.toContain('AI:');
    expect(existsSync(narrationLockPathFor(file))).toBe(false);
  });

  it('--fresh removes the saved explanations as well as the saved decisions', async () => {
    const twinPort = await closedPort();
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(await startApp()));
    await record(file, twinPort, join(dir, 'a'), fakeModel().ai);
    expect(existsSync(narrationLockPathFor(file))).toBe(true);

    const { report } = await record(file, twinPort, join(dir, 'b'), null, ['--fresh']);
    expect(existsSync(narrationLockPathFor(file))).toBe(false);
    expect(failingFindings(report).every((f) => f.explanationSource === 'template')).toBe(true);
  });

  it('hands the explanations to a separate twin, so the dashboard report carries them too', async () => {
    const twin: Twin = await createTwin({ port: 0 });
    closers.push(() => twin.close());
    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(await startApp()));
    const { ai } = fakeModel();
    const { report } = await record(file, await closedPort(), join(dir, 'a'), ai, ['--twin-url', twin.url]);

    const fromTwin = (await (await fetch(`${twin.url}/_ff/runs/${report.runId}/report`)).json()) as Report;
    const findings = failingFindings(fromTwin);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.explanation === 'Written by the model.' && f.explanationSource === 'model')).toBe(true);
    expect(fromTwin.ai?.model).toBe('claude-opus-5-5');
  });
});

describe('a separate twin replays the recorded customer decisions (--decisions)', () => {
  it('uses the decisions in the given file instead of its own, so a hosted demo replays a recording', async () => {
    const lock = join(dir, 'recorded.lock.json');
    writeFileSync(lock, JSON.stringify({ 'Sam:payment_failed:1': { action: 'cancel' } }));
    const twinPort = await closedPort();
    let stop: () => void = () => undefined;
    const stopped = new Promise<void>((r) => (stop = r));
    const c = capture();
    const running = main(['twin', '--port', String(twinPort), '--decisions', lock], { ...c.io, ai: null, waitForInterrupt: () => stopped });
    closers.push(async () => {
      stop();
      await running;
    });
    for (let i = 0; i < 50 && !c.out.includes('listening'); i += 1) await new Promise((r) => setTimeout(r, 100));
    expect(c.out).toContain('listening');

    const file = join(dir, 'tiny.yaml');
    writeFileSync(file, scenarioYaml(await startApp()));
    const result = await runScenarioFile(file, { twinUrl: `http://127.0.0.1:${twinPort}`, ai: null, reportDir: join(dir, 'a') });
    const decisions = result.trace.flatMap((t) => (t.kind === 'customer_decision' ? [t.decision.action] : []));
    expect(decisions[0]).toBe('cancel'); // the recorded decision, not the scripted "ignore"
    // The twin made that decision, not this process, yet the report still counts it as the model's.
    const first = result.trace.find((t) => t.kind === 'customer_decision');
    expect(first && 'by' in first ? first.by : undefined).toBe('model');
    expect(result.report.ai?.customerDecisions.model).toBe(1);
  });

  it('says what the flag is for in the usage text', async () => {
    const c = capture();
    await main([], c.io);
    expect(c.err).toContain('--decisions');
  });
});
