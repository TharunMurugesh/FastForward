import type { Report, Scenario } from '@fastforward/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildReport } from '../src/checks/index.js';
import { createTwin, type Twin } from '../src/index.js';
import { FakeApp } from './support/fake-app.js';

const json = { 'content-type': 'application/json' };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

async function setup() {
  const twin: Twin = await createTwin({ port: 0 });
  closers.push(() => twin.close());
  const app = new FakeApp({ twinUrl: twin.url });
  await app.start();
  closers.push(() => app.close());
  const scenario = (name: string): Scenario => ({
    name,
    seed: 1,
    start: '2026-11-01T00:00:00.000Z',
    durationDays: 40,
    app: { webhookUrl: app.webhookUrl, webhookId: 'WH-FF-LOCAL', subscribeUrl: app.subscribeUrl, probeUrl: app.probeUrl },
    plan: { name: 'Monthly', price: '12.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
    customers: [{ name: 'Maya', email: 'maya@example.test', persona: '', card: { kind: 'ok' }, actions: [] }],
    weather: { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false },
    expect: { accessWhile: ['ACTIVE'] },
  });
  const post = (path: string, body: unknown = {}) => fetch(`${twin.url}${path}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  const get = (path: string) => fetch(`${twin.url}${path}`);
  const startRun = async (name: string) => ((await (await post('/_ff/runs', { scenario: scenario(name) })).json()) as { runId: string }).runId;
  return { twin, app, post, get, startRun };
}

describe('control API gaps', { timeout: 60_000 }, () => {
  it('GET /_ff/runs/current answers 404 before any run', async () => {
    const { get } = await setup();
    const res = await get('/_ff/runs/current');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it('GET /_ff/runs/current names the active run, then the latest finished one', async () => {
    const { get, post, startRun } = await setup();
    const first = await startRun('first');
    expect(await (await get('/_ff/runs/current')).json()).toEqual({ runId: first, finished: false });

    await post(`/_ff/runs/${first}/finish`);
    expect(await (await get('/_ff/runs/current')).json()).toEqual({ runId: first, finished: true });

    const second = await startRun('second');
    expect(await (await get('/_ff/runs/current')).json()).toEqual({ runId: second, finished: false });
  });

  it('GET /_ff/runs/:id includes start (the scenario start, not the current time)', async () => {
    const { get, post, startRun } = await setup();
    const id = await startRun('with-start');
    await post(`/_ff/runs/${id}/advance`, { by: 'P5D' });
    const info = (await (await get(`/_ff/runs/${id}`)).json()) as Record<string, unknown>;
    expect(info).toMatchObject({ runId: id, start: '2026-11-01T00:00:00.000Z', now: '2026-11-06T00:00:00.000Z', end: '2026-12-11T00:00:00.000Z', finished: false });
    expect(info.subscriptions).toEqual([{ customer: 'Maya', subscriptionId: expect.any(String) }]);
  });

  it('GET /_ff/runs/:id/report answers 404 while the run is unfinished', async () => {
    const { get, startRun } = await setup();
    const id = await startRun('unfinished');
    const res = await get(`/_ff/runs/${id}/report`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/not finished/);
  });

  it('GET /_ff/runs/:id/report returns the checked report once the run has finished', async () => {
    const { twin, get, post, startRun } = await setup();
    const id = await startRun('finished');
    const run = twin.activeRun()!;
    await post(`/_ff/runs/${id}/finish`);

    const res = await get(`/_ff/runs/${id}/report`);
    expect(res.status).toBe(200);
    const report = (await res.json()) as Report;
    expect(report).toMatchObject({ runId: id, scenario: 'finished', start: '2026-11-01T00:00:00.000Z', end: '2026-12-11T00:00:00.000Z' });
    expect(report.checks.map((c) => c.id)).toEqual(['ACK_FAST', 'VERIFIES_SIGNATURES', 'STATE_MATCHES', 'FULFIL_ONCE', 'DISPUTE_ANSWERED', 'NO_LIVE_CALLS']);
    expect(report.counts.customers).toBe(1);
    expect(report.counts.events).toBeGreaterThan(0);
    expect(report.counts.deliveries).toBeGreaterThanOrEqual(report.counts.events);
    expect(report).toEqual(buildReport({ runId: id, scenario: run.scenario, start: run.scenario.start, end: run.end.toISOString(), trace: run.trace }));
    // The well-behaved fake app passes every check that applies.
    expect(report.checks.filter((c) => c.status === 'fail')).toEqual([]);
  });

  it('report and current answer 404 for an unknown run id', async () => {
    const { get } = await setup();
    expect((await get('/_ff/runs/run-nope/report')).status).toBe(404);
    expect((await get('/_ff/runs/run-nope')).status).toBe(404);
  });

  it('the stream sends one TraceEntry JSON per data line', async () => {
    const { twin, post, startRun } = await setup();
    const id = await startRun('stream');
    await post(`/_ff/runs/${id}/finish`);
    const res = await fetch(`${twin.url}/_ff/runs/${id}/stream`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text(); // the run is finished, so the stream replays the trace and ends
    const lines = text.split('\n').filter((l) => l !== '');
    expect(lines.length).toBeGreaterThan(3);
    for (const line of lines) {
      expect(line.startsWith('data: ')).toBe(true);
      const entry = JSON.parse(line.slice(6)) as { at: string; kind: string };
      expect(typeof entry.at).toBe('string');
      expect(typeof entry.kind).toBe('string');
    }
    expect(lines.length).toBe((await (await fetch(`${twin.url}/_ff/runs/${id}/trace`)).json() as unknown[]).length);
  });
});
