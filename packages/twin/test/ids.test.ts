import type { Scenario, TraceEntry } from '@fastforward/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { newId, seedIds } from '../src/ids.js';
import { createTwin, type Twin } from '../src/index.js';
import { newPayerId } from '../src/subscriptions/card.js';
import { FakeApp } from './support/fake-app.js';

afterEach(() => seedIds(null));

const sample = () => [newId('I'), newId('P'), newId('PROD'), newId('WH'), newId('PP-D'), newId('SALE'), newPayerId()];

describe('seeded ids', () => {
  it('the same seed gives the same ids in the same order, another seed gives others', () => {
    seedIds(7);
    const a = sample();
    seedIds(7);
    expect(sample()).toEqual(a);
    seedIds(8);
    expect(sample()).not.toEqual(a);
  });

  it('still look like PayPal ids and are unique within a run', () => {
    seedIds(42);
    const ids = Array.from({ length: 500 }, () => newId('I'));
    expect(new Set(ids).size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^I-[A-Z0-9]{12}$/);
    expect(newId('WH')).toMatch(/^WH-[A-Z0-9]{17}-[A-Z0-9]{17}$/);
    expect(newId('PP-D')).toMatch(/^PP-D-[0-9]{5}$/);
    expect(newPayerId()).toMatch(/^[2-9A-HJ-NP-Z]{13}$/);
  });

  it('seedIds(null) goes back to random ids', () => {
    seedIds(null);
    expect(newId('P')).not.toBe(newId('P'));
  });
});

describe('two runs of one scenario', { timeout: 60_000 }, () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (closers.length > 0) await closers.pop()!();
  });

  it('produce the same notice ids, so a recording of one matches a replay of the other', async () => {
    const twin: Twin = await createTwin({ port: 0 });
    closers.push(() => twin.close());
    const app = new FakeApp({ twinUrl: twin.url });
    await app.start();
    closers.push(() => app.close());
    const scenario: Scenario = {
      name: 'same-ids',
      seed: 11,
      start: '2026-11-01T00:00:00.000Z',
      durationDays: 40,
      app: { webhookUrl: app.webhookUrl, webhookId: 'WH-FF-LOCAL', subscribeUrl: app.subscribeUrl, probeUrl: app.probeUrl },
      plan: { name: 'Monthly', price: '12.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
      customers: [{ name: 'Maya', email: 'maya@example.test', persona: '', card: { kind: 'ok' }, actions: [] }],
      weather: { duplicates: 0.3, reorder: 0.1, delayMinutes: [0, 30], forged: 1, burst: false },
      expect: { accessWhile: ['ACTIVE'] },
    };
    const headers = { 'content-type': 'application/json' };
    const runOnce = async (): Promise<string[]> => {
      const { runId } = (await (await fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers, body: JSON.stringify({ scenario }) })).json()) as { runId: string };
      await fetch(`${twin.url}/_ff/runs/${runId}/finish`, { method: 'POST', headers, body: '{}' });
      const trace = (await (await fetch(`${twin.url}/_ff/runs/${runId}/trace`)).json()) as TraceEntry[];
      return trace.flatMap((t) => (t.kind === 'event' ? [`${t.event.event_type} ${t.event.id} ${JSON.stringify(t.event.resource.id ?? null)}`] : []));
    };
    const first = await runOnce();
    const second = await runOnce();
    expect(first.length).toBeGreaterThanOrEqual(4); // created, activated and two months of sales, plus any weather extras
    expect(second).toEqual(first);
  });
});
