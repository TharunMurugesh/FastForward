import type { Report, Scenario } from '@fastforward/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { applyExplanations, parseExplanations } from '../src/explanations.js';
import { createTwin, type Twin } from '../src/index.js';
import { FakeApp } from './support/fake-app.js';

const baseReport = (): Report => ({
  runId: 'run-1',
  scenario: 's',
  start: '2026-11-01T00:00:00.000Z',
  end: '2026-12-01T00:00:00.000Z',
  checks: [
    { id: 'FULFIL_ONCE', status: 'fail', findings: [{ at: 'a', summary: 'one', eventIds: [] }, { at: 'b', summary: 'two', eventIds: [] }] },
    { id: 'ACK_FAST', status: 'pass', findings: [] },
  ],
  counts: { events: 1, deliveries: 1, customers: 1 },
});

const payload = {
  items: [
    { check: 'FULFIL_ONCE', index: 0, explanation: 'Written words.', fix: 'Do this.', source: 'model' },
    { check: 'FULFIL_ONCE', index: 1, explanation: 'Template words.', fix: 'Do that.', source: 'template' },
  ],
  ai: { model: 'claude-opus-5-5', customerDecisions: { model: 2, total: 3 }, explanations: { model: 1, total: 2 }, calls: 0 },
};

describe('parseExplanations', () => {
  it('accepts a well-formed body', () => {
    const parsed = parseExplanations(payload);
    expect(typeof parsed).toBe('object');
  });

  it.each([
    ['not an object', 'x'],
    ['no items', {}],
    ['unknown check', { items: [{ check: 'NOPE', index: 0, explanation: 'e', fix: 'f', source: 'model' }] }],
    ['negative index', { items: [{ check: 'ACK_FAST', index: -1, explanation: 'e', fix: 'f', source: 'model' }] }],
    ['empty explanation', { items: [{ check: 'ACK_FAST', index: 0, explanation: '', fix: 'f', source: 'model' }] }],
    ['unknown source', { items: [{ check: 'ACK_FAST', index: 0, explanation: 'e', fix: 'f', source: 'human' }] }],
    ['bad ai summary', { items: [], ai: { model: 5 } }],
  ])('rejects %s with a message naming the problem', (_name, body) => {
    expect(typeof parseExplanations(body)).toBe('string');
  });
});

describe('applyExplanations', () => {
  it('puts each explanation, fix and source on the right finding, and the ai summary on the report', () => {
    const parsed = parseExplanations(payload);
    if (typeof parsed === 'string') throw new Error(parsed);
    const out = applyExplanations(baseReport(), parsed);
    const findings = out.checks[0]!.findings;
    expect(findings[0]).toMatchObject({ explanation: 'Written words.', fix: 'Do this.', explanationSource: 'model' });
    expect(findings[1]).toMatchObject({ explanation: 'Template words.', explanationSource: 'template' });
    expect(out.ai?.customerDecisions).toEqual({ model: 2, total: 3 });
  });

  it('does not change the report it was given, and ignores an item for a finding that does not exist', () => {
    const parsed = parseExplanations({ items: [{ check: 'ACK_FAST', index: 5, explanation: 'e', fix: 'f', source: 'model' }] });
    if (typeof parsed === 'string') throw new Error(parsed);
    const original = baseReport();
    const out = applyExplanations(original, parsed);
    expect(out).toEqual(original);
    const withReal = parseExplanations(payload);
    if (typeof withReal === 'string') throw new Error(withReal);
    applyExplanations(original, withReal);
    expect(original.checks[0]!.findings[0]!.explanation).toBeUndefined();
  });
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

describe('PUT /_ff/runs/:id/explanations', { timeout: 60_000 }, () => {
  async function setup() {
    const twin: Twin = await createTwin({ port: 0 });
    closers.push(() => twin.close());
    const app = new FakeApp({ twinUrl: twin.url });
    await app.start();
    closers.push(() => app.close());
    const scenario: Scenario = {
      name: 'x',
      seed: 1,
      start: '2026-11-01T00:00:00.000Z',
      durationDays: 5,
      app: { webhookUrl: app.webhookUrl, webhookId: 'WH-FF-LOCAL', subscribeUrl: app.subscribeUrl, probeUrl: app.probeUrl },
      plan: { name: 'Monthly', price: '12.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
      customers: [{ name: 'Maya', email: 'maya@example.test', persona: '', card: { kind: 'ok' }, actions: [] }],
      weather: { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false },
      expect: { accessWhile: ['ACTIVE'] },
    };
    const headers = { 'content-type': 'application/json' };
    const created = (await (await fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers, body: JSON.stringify({ scenario }) })).json()) as { runId: string };
    await fetch(`${twin.url}/_ff/runs/${created.runId}/finish`, { method: 'POST', headers, body: '{}' });
    const put = (id: string, body: unknown) => fetch(`${twin.url}/_ff/runs/${id}/explanations`, { method: 'PUT', headers, body: JSON.stringify(body) });
    const report = async (id: string) => (await (await fetch(`${twin.url}/_ff/runs/${id}/report`)).json()) as Report;
    return { id: created.runId, put, report };
  }

  it('stores the explanations and the report then carries them, including the ai summary', async () => {
    const { id, put, report } = await setup();
    expect((await report(id)).ai).toBeUndefined();
    expect((await put(id, payload)).status).toBe(200);
    expect((await report(id)).ai?.model).toBe('claude-opus-5-5');
  });

  it('answers 400 with the problem for a bad body, and 404 for an unknown run', async () => {
    const { id, put } = await setup();
    const bad = await put(id, { items: [{ check: 'NOPE' }] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: expect.stringContaining('check') });
    expect((await put('run-unknown', payload)).status).toBe(404);
  });
});
