import type { Weather, WebhookEvent } from '@fastforward/contracts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A small seeded random number generator: the same seed always gives the same numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlannedDelivery {
  event: WebhookEvent;
  at: Date;
  forged: boolean;
}

/** Send order: by time, and for events at the very same time by `seq` (which reordering swaps too). */
const byTime = (a: { at: Date; seq: number }, b: { at: Date; seq: number }) => a.at.getTime() - b.at.getTime() || a.seq - b.seq;

/**
 * Turns the events the twin emitted (with the time each would ideally be sent) into what PayPal on a
 * bad day would actually send. Steps, always in this order so a seed gives one plan:
 *   1. delay: each event is late by a whole number of minutes in `delayMinutes` [min, max];
 *   2. burst: every renewal (PAYMENT.SALE.COMPLETED) of a UTC day is sent at that day's earliest renewal time;
 *   3. reorder: walking in send order, an event swaps send times (and its place among events sent at the
 *      same instant) with its neighbour with chance `reorder`; pairs never chain, so an event moves at most one place;
 *   4. duplicates: with chance `duplicates` an event is sent a second time, 1 to 10 minutes later, with the
 *      same event id.
 * The input is not changed; the result is in send-time order. Forged events are not made here (see
 * `forgedEvents`), so every entry has `forged: false`.
 */
export function planDeliveries(events: { event: WebhookEvent; at: Date }[], weather: Weather, rng: () => number): PlannedDelivery[] {
  const plan = events.map((e, seq) => ({ event: e.event, at: new Date(e.at.getTime()), seq })).sort(byTime);

  const [minDelay, maxDelay] = weather.delayMinutes;
  if (maxDelay > 0) {
    for (const p of plan) {
      const minutes = minDelay + Math.floor(rng() * (maxDelay - minDelay + 1));
      p.at = new Date(p.at.getTime() + minutes * MINUTE);
    }
    plan.sort(byTime);
  }

  if (weather.burst) {
    const earliest = new Map<number, number>();
    for (const p of plan) {
      if (p.event.event_type !== 'PAYMENT.SALE.COMPLETED') continue;
      const dayStart = Math.floor(p.at.getTime() / DAY);
      if (!earliest.has(dayStart)) earliest.set(dayStart, p.at.getTime()); // plan is sorted, so the first seen is the earliest
    }
    for (const p of plan) {
      if (p.event.event_type === 'PAYMENT.SALE.COMPLETED') p.at = new Date(earliest.get(Math.floor(p.at.getTime() / DAY))!);
    }
    plan.sort(byTime);
  }

  if (weather.reorder > 0) {
    for (let i = 0; i < plan.length - 1; i += 1) {
      if (rng() < weather.reorder) {
        const a = plan[i]!;
        const b = plan[i + 1]!;
        [a.at, b.at] = [b.at, a.at];
        [a.seq, b.seq] = [b.seq, a.seq]; // events emitted at one instant trade places too
        i += 1;
      }
    }
    plan.sort(byTime);
  }

  const out = plan.map((p) => ({ event: p.event, at: p.at, seq: p.seq, forged: false }));
  if (weather.duplicates > 0) {
    for (const p of plan) {
      if (rng() < weather.duplicates) {
        const later = 1 + Math.floor(rng() * 10);
        out.push({ event: p.event, at: new Date(p.at.getTime() + later * MINUTE), seq: p.seq, forged: false });
      }
    }
    out.sort(byTime);
  }
  return out.map(({ event, at, forged }) => ({ event, at, forged }));
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const token = (rng: () => number, n: number) => Array.from({ length: n }, () => ALPHABET[Math.floor(rng() * ALPHABET.length)]).join('');

/**
 * `count` notices that claim a cancellation or a failed payment for one of `subscriptions`. They are
 * well-formed PayPal envelopes; the dispatcher signs them so that verification fails (`forged: true`),
 * and nothing in the twin changes. An app that believes one has a security hole. Ids come from `rng`
 * so a seed always gives the same notices; `at(i)` gives notice i's creation time.
 */
export function forgedEvents(subscriptions: string[], count: number, rng: () => number, at: (i: number) => Date): WebhookEvent[] {
  if (subscriptions.length === 0) return [];
  return Array.from({ length: Math.max(count, 0) }, (_, i): WebhookEvent => {
    const subscriptionId = subscriptions[Math.floor(rng() * subscriptions.length)]!;
    const cancelled = rng() < 0.5;
    const time = at(i).toISOString();
    return {
      id: `WH-${token(rng, 17)}-${token(rng, 17)}`,
      event_version: '1.0',
      create_time: time,
      resource_type: 'subscription',
      event_type: cancelled ? 'BILLING.SUBSCRIPTION.CANCELLED' : 'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      summary: cancelled ? 'Subscription cancelled' : 'Payment failed on subscription',
      resource: cancelled
        ? { id: subscriptionId, plan_id: 'P-FORGED', status: 'CANCELLED', status_change_note: 'Cancelled by the customer', status_update_time: time }
        : {
            id: subscriptionId,
            plan_id: 'P-FORGED',
            status: 'ACTIVE',
            billing_info: { outstanding_balance: { currency_code: 'USD', value: '5.00' }, failed_payments_count: 1 },
          },
      links: [],
    };
  });
}
