import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TraceEntry, Weather, WebhookEvent } from '@fastforward/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SubscriptionEngine } from '../src/subscriptions/engine.js';
import { VirtualClock } from '../src/time/clock.js';
import { Scheduler } from '../src/time/scheduler.js';
import { Dispatcher, VerifyLedger } from '../src/webhooks/dispatcher.js';
import { createSigner, signingString } from '../src/webhooks/sign.js';
import { forgedEvents, mulberry32, planDeliveries } from '../src/webhooks/weather.js';

const calm: Weather = { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false };
const weather = (o: Partial<Weather>): Weather => ({ ...calm, ...o });
const MIN = 60_000;
const t0 = Date.UTC(2026, 10, 1);

const mk = (id: string, type: WebhookEvent['event_type'] = 'PAYMENT.SALE.COMPLETED'): WebhookEvent => ({
  id,
  event_version: '1.0',
  create_time: '2026-11-01T00:00:00.000Z',
  resource_type: 'sale',
  event_type: type,
  summary: id,
  resource: {},
  links: [],
});
const item = (id: string, minutes: number, type?: WebhookEvent['event_type']) => ({ event: mk(id, type), at: new Date(t0 + minutes * MIN) });
const four = () => [item('A', 0), item('B', 10), item('C', 20), item('D', 30)];
const view = (plan: { event: WebhookEvent; at: Date; forged: boolean }[]) => plan.map((p) => `${p.event.id}@${(p.at.getTime() - t0) / MIN}${p.forged ? '!' : ''}`);

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(990);
    expect(Array.from({ length: 5 }, mulberry32(43))).not.toEqual(xs.slice(0, 5));
  });

  it('is roughly uniform', () => {
    const rng = mulberry32(7);
    const mean = Array.from({ length: 10_000 }, () => rng()).reduce((s, x) => s + x, 0) / 10_000;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});

describe('planDeliveries', () => {
  it('calm weather delivers every event once, in order, untouched', () => {
    expect(view(planDeliveries(four(), calm, mulberry32(1)))).toEqual(['A@0', 'B@10', 'C@20', 'D@30']);
  });

  it('same seed gives identical plan', () => {
    const w = weather({ duplicates: 0.5, reorder: 0.5, delayMinutes: [0, 90], burst: true });
    const events = Array.from({ length: 40 }, (_, i) => item(`E${i}`, i * 700));
    const first = view(planDeliveries(events, w, mulberry32(42)));
    const second = view(planDeliveries(events, w, mulberry32(42)));
    expect(first).toEqual(second);
    expect(view(planDeliveries(events, w, mulberry32(43)))).not.toEqual(first);
  });

  it('duplicates 1.0 doubles every event with identical ids', () => {
    const plan = planDeliveries(four(), weather({ duplicates: 1 }), mulberry32(3));
    expect(plan).toHaveLength(8);
    for (const id of ['A', 'B', 'C', 'D']) {
      const copies = plan.filter((p) => p.event.id === id);
      expect(copies).toHaveLength(2);
      expect(copies[0]!.event).toBe(copies[1]!.event);
      expect(copies[1]!.at.getTime()).toBeGreaterThan(copies[0]!.at.getTime());
    }
    expect(plan.every((p) => !p.forged)).toBe(true);
  });

  it('duplicates 0 adds nothing', () => {
    expect(planDeliveries(four(), weather({ duplicates: 0 }), mulberry32(3))).toHaveLength(4);
  });

  it('reorder 1.0 swaps neighbours', () => {
    const plan = planDeliveries(four(), weather({ reorder: 1 }), mulberry32(3));
    // The events keep their ids but trade send times pairwise: B goes first, then A, then D, then C.
    expect(view(plan)).toEqual(['B@0', 'A@10', 'D@20', 'C@30']);
  });

  it('reorder with an odd count leaves the last event alone', () => {
    const plan = planDeliveries([item('A', 0), item('B', 10), item('C', 20)], weather({ reorder: 1 }), mulberry32(3));
    expect(view(plan)).toEqual(['B@0', 'A@10', 'C@20']);
  });

  it('reorder 1.0 also swaps events that were emitted at the same instant', () => {
    const simultaneous = [item('A', 0), item('B', 0), item('C', 0), item('D', 0)];
    expect(view(planDeliveries(simultaneous, weather({ reorder: 1 }), mulberry32(3))).map((v) => v[0])).toEqual(['B', 'A', 'D', 'C']);
    expect(view(planDeliveries(simultaneous, calm, mulberry32(3))).map((v) => v[0])).toEqual(['A', 'B', 'C', 'D']);
  });

  it('delays stay inside [min,max]', () => {
    const events = Array.from({ length: 300 }, (_, i) => item(`E${i}`, i * 1000));
    const plan = planDeliveries(events, weather({ delayMinutes: [5, 90] }), mulberry32(9));
    const delays = plan.map((p) => (p.at.getTime() - events.find((e) => e.event.id === p.event.id)!.at.getTime()) / MIN);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(5);
    expect(Math.max(...delays)).toBeLessThanOrEqual(90);
    expect(Math.max(...delays) - Math.min(...delays)).toBeGreaterThan(60); // actually spread out
  });

  it('a zero-width delay range of [30, 30] moves every event by exactly 30 minutes', () => {
    const plan = planDeliveries(four(), weather({ delayMinutes: [30, 30] }), mulberry32(2));
    expect(view(plan)).toEqual(['A@30', 'B@40', 'C@50', 'D@60']);
  });

  it('burst moves every renewal of a day to the earliest renewal of that day', () => {
    const day2 = 24 * 60;
    const events = [
      item('S1', 60), // day 1
      item('S2', 600), // day 1
      item('F1', 700, 'BILLING.SUBSCRIPTION.PAYMENT.FAILED'), // not a renewal: untouched
      item('S3', 1300), // day 1, 21:40
      item('S4', day2 + 120), // day 2
      item('S5', day2 + 900), // day 2
    ];
    const plan = planDeliveries(events, weather({ burst: true }), mulberry32(1));
    expect(view(plan)).toEqual(['S1@60', 'S2@60', 'S3@60', 'F1@700', 'S4@1560', 'S5@1560']);
  });

  it('returns events in send-time order and does not mutate its input', () => {
    const events = four();
    const copy = events.map((e) => ({ ...e, at: new Date(e.at) }));
    const plan = planDeliveries(events, weather({ duplicates: 0.5, reorder: 0.5, delayMinutes: [0, 60] }), mulberry32(5));
    expect(events).toEqual(copy);
    for (let i = 1; i < plan.length; i += 1) expect(plan[i]!.at.getTime()).toBeGreaterThanOrEqual(plan[i - 1]!.at.getTime());
  });
});

describe('forgedEvents', () => {
  const at = (i: number) => new Date(t0 + i * MIN);
  const subs = ['I-AAAAAAAAAAAA', 'I-BBBBBBBBBBBB', 'I-CCCCCCCCCCCC'];

  it('makes count events that claim a cancellation or a failure for the given subscriptions', () => {
    const events = forgedEvents(subs, 40, mulberry32(11), at);
    expect(events).toHaveLength(40);
    for (const [i, e] of events.entries()) {
      expect(['BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED']).toContain(e.event_type);
      expect(subs).toContain(e.resource.id);
      expect(e.id).toMatch(/^WH-[A-Z0-9]{17}-[A-Z0-9]{17}$/);
      expect(e.create_time).toBe(at(i).toISOString());
      expect(e.event_version).toBe('1.0');
    }
    expect(new Set(events.map((e) => e.event_type)).size).toBe(2);
    expect(new Set(events.map((e) => e.resource.id)).size).toBe(3);
    expect(new Set(events.map((e) => e.id)).size).toBe(40);
  });

  it('is deterministic per seed', () => {
    expect(forgedEvents(subs, 10, mulberry32(5), at)).toEqual(forgedEvents(subs, 10, mulberry32(5), at));
  });

  it('makes nothing for count 0 or no subscriptions', () => {
    expect(forgedEvents(subs, 0, mulberry32(1), at)).toEqual([]);
    expect(forgedEvents([], 5, mulberry32(1), at)).toEqual([]);
  });

  describe('through the dispatcher', () => {
    const closers: (() => Promise<void>)[] = [];
    afterEach(async () => {
      while (closers.length > 0) await closers.pop()!();
    });

    it('forged events fail verification and do not change twin state', async () => {
      const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
      const scheduler = new Scheduler(clock);
      const engine = new SubscriptionEngine({ clock, scheduler, emit: () => {}, cardOutcome: () => 'ok' });
      engine.usePlan({ name: 'P', price: '5.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 });
      const created = engine.createSubscription({ plan_id: 'P-X' }) as { id: string };
      engine.approve(created.id);
      await scheduler.advanceTo(clock.now());

      const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
          res.end('ok');
        });
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      closers.push(() => new Promise((r) => server.close(() => r())));
      const { port } = server.address() as AddressInfo;

      const signer = await createSigner('weathertest');
      const trace: TraceEntry[] = [];
      const dispatcher = new Dispatcher({
        scheduler,
        clock,
        signer,
        webhookUrl: `http://127.0.0.1:${port}/hook`,
        webhookId: 'WH-FF-LOCAL',
        runId: 'run-weather',
        record: (t) => trace.push(t),
        verifyCalls: new VerifyLedger(),
        timeoutMs: 2000,
      });

      const [claim] = forgedEvents([created.id], 1, mulberry32(8), () => clock.now());
      await dispatcher.send(claim!, { forged: true });
      await dispatcher.send(claim!, { forged: false }); // the same bytes, signed genuinely, for contrast

      const verdicts = received.map((r) => {
        const input = signingString(String(r.headers['paypal-transmission-id']), String(r.headers['paypal-transmission-time']), 'WH-FF-LOCAL', r.body);
        return signer.verify(input, String(r.headers['paypal-transmission-sig']));
      });
      expect(verdicts).toEqual([false, true]);
      expect(trace.filter((t) => t.kind === 'event')).toHaveLength(1);

      // A forged notice is only an envelope sent to the app: the twin's own state is untouched.
      expect(engine.get(created.id).status).toBe('ACTIVE');
      expect(engine.completedPayments(created.id)).toBe(1);
    });
  });
});
