import type { Customer, Scenario, TraceEntry, Weather } from '@fastforward/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks/index.js';
import { createTwin, type Twin } from '../src/index.js';
import { FakeApp } from './support/fake-app.js';

const json = { 'content-type': 'application/json' };
const calm: Weather = { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false };

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (closers.length > 0) await closers.pop()!();
});

const customer = (name: string, extra: Partial<Customer> = {}): Customer => ({ name, email: `${name.toLowerCase()}@example.test`, persona: '', card: { kind: 'ok' }, actions: [], ...extra });

async function playRun(weather: Partial<Weather>, opts: { seed?: number; customers?: Customer[]; days?: number } = {}) {
  const twin: Twin = await createTwin({ port: 0 });
  closers.push(() => twin.close());
  const app = new FakeApp({ twinUrl: twin.url });
  await app.start();
  closers.push(() => app.close());
  const scenario: Scenario = {
    name: 'weather',
    seed: opts.seed ?? 42,
    start: '2026-11-01T00:00:00.000Z',
    durationDays: opts.days ?? 61,
    app: { webhookUrl: app.webhookUrl, webhookId: 'WH-FF-LOCAL', subscribeUrl: app.subscribeUrl, probeUrl: app.probeUrl },
    plan: { name: 'Monthly', price: '12.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
    customers: opts.customers ?? [customer('Maya')],
    weather: { ...calm, ...weather },
    expect: { accessWhile: ['ACTIVE'] },
  };
  const created = await fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers: json, body: JSON.stringify({ scenario }) });
  const { runId } = (await created.json()) as { runId: string };
  const run = twin.activeRun()!;
  const finished = await fetch(`${twin.url}/_ff/runs/${runId}/finish`, { method: 'POST', headers: json, body: '{}' });
  expect(finished.status).toBe(200);
  return { twin, app, run, scenario, trace: run.trace };
}

type Of<K extends TraceEntry['kind']> = Extract<TraceEntry, { kind: K }>;
const only = <K extends TraceEntry['kind']>(trace: TraceEntry[], kind: K) => trace.filter((t): t is Of<K> => t.kind === kind);

/**
 * A trace with everything random or timing-dependent removed: ids become first-seen ordinals, delivery
 * milliseconds and resource bodies are dropped. Two runs with one seed must produce the same result.
 */
function normalise(trace: TraceEntry[]): unknown[] {
  const ids = new Map<string, string>();
  const tag = (prefix: string, value: string) => {
    if (!ids.has(value)) ids.set(value, `${prefix}${ids.size + 1}`);
    return ids.get(value)!;
  };
  const scrub = (path: string) => path.replace(/I-[A-Z0-9]{12}/g, (m) => tag('S', m));
  return trace.map((t) => {
    switch (t.kind) {
      case 'event':
        return { at: t.at, kind: t.kind, forged: t.forged, id: tag('E', t.event.id), type: t.event.event_type };
      case 'delivery':
        return { at: t.at, kind: t.kind, attempt: t.attempt, status: t.status, event: tag('E', t.eventId), transmission: tag('T', t.transmissionId) };
      case 'app_call':
        return { at: t.at, kind: t.kind, method: t.method, path: scrub(t.path), status: t.status };
      case 'probe':
        return { ...t, subscriptionId: tag('S', t.subscriptionId) };
      case 'verify_call':
        return { ...t, transmissionId: tag('T', t.transmissionId) };
      default:
        return t;
    }
  });
}

describe('weather in runs', { timeout: 120_000 }, () => {
  it('calm weather delivers every event once', async () => {
    const { app, trace } = await playRun({});
    const events = only(trace, 'event');
    expect(app.events).toHaveLength(events.length);
    expect(new Set(app.events.map((e) => e.id)).size).toBe(events.length);
    expect(only(trace, 'event').every((e) => !e.forged)).toBe(true);
  });

  it('duplicates 1.0 delivers every event twice with the same id, as two separate first attempts', async () => {
    const { app, trace, run, scenario } = await playRun({ duplicates: 1 });
    const events = only(trace, 'event');
    // A copy is sent 1-10 minutes after the original, so one sent right at the end of the run never arrives.
    const early = events.filter((e) => Date.parse(e.at) < run.end.getTime() - 11 * 60_000);
    expect(early.length).toBeGreaterThan(2);
    for (const e of events) {
      const deliveries = only(trace, 'delivery').filter((d) => d.eventId === e.event.id);
      expect(deliveries.map((d) => d.attempt)).toEqual(early.includes(e) ? [1, 1] : expect.arrayContaining([1]));
      expect(new Set(deliveries.map((d) => d.transmissionId)).size).toBe(deliveries.length);
    }
    expect(app.events.length).toBeGreaterThan(events.length);
    // The app dedupes by event id, so nothing is fulfilled twice.
    expect(runChecks(trace, scenario).find((c) => c.id === 'FULFIL_ONCE')!.status).toBe('pass');
  });

  it('delay [30,60] sends the first events 30 to 60 minutes late', async () => {
    const { trace } = await playRun({ delayMinutes: [30, 60] });
    const first = only(trace, 'event').slice(0, 3);
    expect(first).toHaveLength(3);
    for (const e of first) {
      const minutes = (Date.parse(e.at) - Date.parse('2026-11-01T00:00:00.000Z')) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual(30);
      expect(minutes).toBeLessThanOrEqual(60);
    }
  });

  it('reorder 1.0 swaps the first two events of a batch', async () => {
    const { trace } = await playRun({ reorder: 1 });
    const order = only(trace, 'event').slice(0, 3).map((e) => e.event.event_type);
    expect(order).toEqual(['BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.CREATED', 'PAYMENT.SALE.COMPLETED']);
  });

  it('burst sends all renewals of a day at one instant, even when delays would spread them', async () => {
    const customers = [customer('Maya'), customer('Leo'), customer('Ana'), customer('Sam')];
    const spread = await playRun({ delayMinutes: [0, 120] }, { customers });
    const bursty = await playRun({ delayMinutes: [0, 120], burst: true }, { customers });
    const renewalTimes = (trace: TraceEntry[]) =>
      new Set(only(trace, 'event').filter((e) => e.event.event_type === 'PAYMENT.SALE.COMPLETED' && e.at.startsWith('2026-12-01')).map((e) => e.at));
    expect(renewalTimes(spread.trace).size).toBeGreaterThan(1);
    expect(renewalTimes(bursty.trace).size).toBe(1);
    // Four sales per renewal day were still delivered.
    expect(only(bursty.trace, 'event').filter((e) => e.event.event_type === 'PAYMENT.SALE.COMPLETED' && e.at.startsWith('2026-12-01'))).toHaveLength(4);
  });

  it('forged: 3 schedules three forged events inside the run; a verifying app rejects them and its state is untouched', async () => {
    const { trace, run, scenario } = await playRun({ forged: 3 });
    const forged = only(trace, 'event').filter((e) => e.forged);
    expect(forged).toHaveLength(3);
    for (const e of forged) {
      expect(['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED']).toContain(e.event.event_type);
      expect(Date.parse(e.at)).toBeGreaterThanOrEqual(Date.parse(scenario.start));
      expect(Date.parse(e.at)).toBeLessThanOrEqual(run.end.getTime());
      expect(only(trace, 'delivery').some((d) => d.eventId === e.event.id)).toBe(true);
    }
    const results = runChecks(trace, scenario);
    expect(results.find((c) => c.id === 'STATE_MATCHES')!.status).toBe('pass');
    expect(results.find((c) => c.id === 'VERIFIES_SIGNATURES')!.status).toBe('pass');
    // The twin itself never saw a cancellation.
    expect(only(trace, 'event').filter((e) => !e.forged && e.event.event_type === 'BILLING.SUBSCRIPTION.CANCELLED')).toEqual([]);
  });

  const stormy: Partial<Weather> = { duplicates: 0.5, reorder: 0.5, delayMinutes: [0, 90], forged: 2, burst: true };

  it('same seed gives an identical trace; a different seed gives a different one', async () => {
    const customers = [customer('Maya'), customer('Leo', { card: { kind: 'fails_from', date: '2026-12-01' } })];
    const a = await playRun(stormy, { seed: 7, customers });
    const b = await playRun(stormy, { seed: 7, customers });
    const c = await playRun(stormy, { seed: 8, customers });
    expect(normalise(a.trace)).toEqual(normalise(b.trace));
    expect(normalise(a.trace)).not.toEqual(normalise(c.trace));
    expect(only(a.trace, 'event').length).toBeGreaterThan(8);
  });
});
