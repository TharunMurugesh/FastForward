import type { Scenario, TraceEntry, WebhookEvent } from '@fastforward/contracts';

type Of<K extends TraceEntry['kind']> = Extract<TraceEntry, { kind: K }>;

/** The trace sliced and indexed once, shared by every check. */
export interface CheckContext {
  scenario: Scenario;
  events: Of<'event'>[];
  eventById: Map<string, WebhookEvent>;
  /** Ids of events the twin forged on purpose (a correct app rejects these). */
  forgedIds: Set<string>;
  deliveries: Of<'delivery'>[];
  /** Delivery attempts grouped by the event they carried, in trace order. */
  deliveriesByEvent: Map<string, Of<'delivery'>[]>;
  /** Genuine sale notices per subscription, in trace order. */
  salesBySubscription: Map<string, Of<'event'>[]>;
  probes: Of<'probe'>[];
  disputeActions: Of<'dispute_action'>[];
  verifyCalls: Of<'verify_call'>[];
  certFetches: Of<'cert_fetch'>[];
  liveCalls: Of<'live_call_blocked'>[];
  /** A readable name for a subscription: the scenario customer it belongs to, else its id. */
  customerOf(subscriptionId: string): string;
  /**
   * PayPal's status for a subscription at a moment, from genuine (not forged) notices, and the notice that
   * announced it. Ordered by when the status really changed (the resource's status_update_time), not by when
   * the notice reached the app, so reordered or late notices still name the right one.
   */
  statusAt(subscriptionId: string, at: string): { status: string; eventId: string } | null;
}

const STATUS_RANK: Record<string, number> = { APPROVAL_PENDING: 1, APPROVED: 2, ACTIVE: 3, SUSPENDED: 4, CANCELLED: 5, EXPIRED: 5 };

export const day = (iso: string): string => iso.slice(0, 10);

function subscriptionIdOf(resource: Record<string, unknown>): string | null {
  if (typeof resource.billing_agreement_id === 'string') return resource.billing_agreement_id; // a sale
  if (typeof resource.id === 'string' && typeof resource.plan_id === 'string') return resource.id; // a subscription
  return null;
}

export function buildContext(trace: TraceEntry[], scenario: Scenario): CheckContext {
  const pick = <K extends TraceEntry['kind']>(kind: K): Of<K>[] => trace.filter((t): t is Of<K> => t.kind === kind);
  const events = pick('event');
  const eventById = new Map(events.map((e) => [e.event.id, e.event]));
  const forgedIds = new Set(events.filter((e) => e.forged).map((e) => e.event.id));

  // custom_id on a subscription is what the app (or the twin) stored to say who the subscriber is.
  const customIds = new Map<string, string>();
  const statuses = new Map<string, { at: number; status: string; eventId: string; rank: number }[]>();
  for (const { at, event, forged } of events) {
    if (forged) continue;
    const subId = subscriptionIdOf(event.resource);
    if (!subId) continue;
    const customId = event.resource.custom_id;
    if (typeof customId === 'string') customIds.set(subId, customId);
    const status = event.resource.status;
    if (typeof status === 'string' && event.resource.id === subId) {
      const list = statuses.get(subId) ?? [];
      const changed = Date.parse(String(event.resource.status_update_time ?? at));
      list.push({ at: Number.isNaN(changed) ? Date.parse(at) : changed, status, eventId: event.id, rank: STATUS_RANK[status] ?? 0 });
      statuses.set(subId, list);
    }
  }

  const deliveries = pick('delivery');
  const deliveriesByEvent = new Map<string, Of<'delivery'>[]>();
  for (const d of deliveries) {
    const list = deliveriesByEvent.get(d.eventId);
    if (list) list.push(d);
    else deliveriesByEvent.set(d.eventId, [d]);
  }
  const salesBySubscription = new Map<string, Of<'event'>[]>();
  for (const e of events) {
    const subId = e.event.resource.billing_agreement_id;
    if (e.forged || e.event.event_type !== 'PAYMENT.SALE.COMPLETED' || typeof subId !== 'string') continue;
    const list = salesBySubscription.get(subId);
    if (list) list.push(e);
    else salesBySubscription.set(subId, [e]);
  }

  const lower = (s: string) => s.trim().toLowerCase();
  return {
    scenario,
    events,
    eventById,
    forgedIds,
    deliveries,
    deliveriesByEvent,
    salesBySubscription,
    probes: pick('probe'),
    disputeActions: pick('dispute_action'),
    verifyCalls: pick('verify_call'),
    certFetches: pick('cert_fetch'),
    liveCalls: pick('live_call_blocked'),
    customerOf(subscriptionId) {
      const customId = customIds.get(subscriptionId);
      if (customId === undefined) return subscriptionId;
      const match = scenario.customers.find((c) => lower(c.name) === lower(customId) || lower(c.email) === lower(customId));
      return match?.name ?? customId;
    },
    statusAt(subscriptionId, at) {
      const t = Date.parse(at);
      let found: { status: string; eventId: string } | null = null;
      let best: { at: number; rank: number } | null = null;
      for (const s of statuses.get(subscriptionId) ?? []) {
        if (s.at > t) continue;
        // Latest status change wins; at the same instant the later stage of the lifecycle wins (ACTIVE over APPROVAL_PENDING).
        if (!best || s.at > best.at || (s.at === best.at && s.rank > best.rank)) {
          best = s;
          found = { status: s.status, eventId: s.eventId };
        }
      }
      return found;
    },
  };
}

export interface Stretch<P> {
  first: P;
  last: P;
  count: number;
}

/**
 * Groups consecutive bad probes of one subscription that show the same wrong value into one stretch.
 * `valueOf` returns null for a good probe and a key for a bad one; a good probe, or a different key,
 * ends the stretch. Subscriptions are tracked separately. Stretches come out in the order they began.
 */
export function stretches<P extends { subscriptionId: string }>(probes: P[], valueOf: (p: P) => string | null): Stretch<P>[] {
  const out: Stretch<P>[] = [];
  const open = new Map<string, { key: string; stretch: Stretch<P> }>();
  for (const p of probes) {
    const key = valueOf(p);
    const current = open.get(p.subscriptionId);
    if (key === null) {
      open.delete(p.subscriptionId);
    } else if (current && current.key === key) {
      current.stretch.last = p;
      current.stretch.count += 1;
    } else {
      const stretch = { first: p, last: p, count: 1 };
      out.push(stretch);
      open.set(p.subscriptionId, { key, stretch });
    }
  }
  return out;
}

/** "on 2026-12-01" for one day, "from 2026-12-01 to 2026-12-30" for a stretch (`single` is used for one check). */
export function span(first: string, last: string, single = 'on'): string {
  return day(first) === day(last) ? `${single} ${day(first)}` : `from ${day(first)} to ${day(last)}`;
}

export const checksNote = (count: number): string => (count > 1 ? ` (${count} checks)` : '');
