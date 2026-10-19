import type { EventType, TraceEntry, WebhookEvent } from '@fastforward/contracts';

export type MarkerKind =
  | 'payment_ok'
  | 'payment_failed'
  | 'suspended'
  | 'cancelled'
  | 'expired'
  | 'dispute'
  | 'forged'
  | 'duplicate'
  | 'delivery_failed';

export interface TimelineRow {
  customer: string;
  subscriptionId: string;
}

export interface TimelineMarker {
  row: number;
  at: string;
  kind: MarkerKind;
  eventId: string;
  /** For delivery_failed: how many attempts failed. A retrying notice is one marker, not a dozen. */
  count?: number;
}

export interface TimelineModel {
  rows: TimelineRow[];
  markers: TimelineMarker[];
}

const KIND_OF_EVENT: Partial<Record<EventType, MarkerKind>> = {
  'PAYMENT.SALE.COMPLETED': 'payment_ok',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'payment_failed',
  'BILLING.SUBSCRIPTION.SUSPENDED': 'suspended',
  'BILLING.SUBSCRIPTION.CANCELLED': 'cancelled',
  'BILLING.SUBSCRIPTION.EXPIRED': 'expired',
  'CUSTOMER.DISPUTE.CREATED': 'dispute',
  'CUSTOMER.DISPUTE.UPDATED': 'dispute',
  'CUSTOMER.DISPUTE.RESOLVED': 'dispute',
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * Which subscription an event belongs to. Subscription events carry it as `resource.id`, sales as
 * `billing_agreement_id`. A dispute names the sale it is about (`disputed_transactions[].seller_transaction_id`),
 * so it is resolved through that sale; `resource.subscription_id` is honoured when a producer sets it.
 */
export function ownerOf(event: WebhookEvent, saleOwner: ReadonlyMap<string, string>): string | undefined {
  const r = event.resource;
  if (event.event_type === 'PAYMENT.SALE.COMPLETED') return str(r.billing_agreement_id);
  if (event.event_type.startsWith('BILLING.SUBSCRIPTION.')) return str(r.id);
  const direct = str(r.subscription_id);
  if (direct) return direct;
  const txns = r.disputed_transactions;
  if (Array.isArray(txns)) {
    for (const t of txns) {
      const sale = str((t as { seller_transaction_id?: unknown })?.seller_transaction_id);
      const owner = sale ? saleOwner.get(sale) : undefined;
      if (owner) return owner;
    }
  }
  return undefined;
}

/** eventId to subscription id, for every event in the trace (sales first so disputes can find them). */
export function eventOwners(trace: TraceEntry[]): Map<string, string> {
  const saleOwner = new Map<string, string>();
  for (const t of trace) {
    if (t.kind === 'event' && t.event.event_type === 'PAYMENT.SALE.COMPLETED') {
      const sale = str(t.event.resource.id);
      const owner = str(t.event.resource.billing_agreement_id);
      if (sale && owner) saleOwner.set(sale, owner);
    }
  }
  const owners = new Map<string, string>();
  for (const t of trace) {
    if (t.kind !== 'event') continue;
    const owner = ownerOf(t.event, saleOwner);
    if (owner) owners.set(t.event.id, owner);
  }
  return owners;
}

export const isFailedDelivery = (d: { status: number | null }): boolean => d.status === null || d.status >= 300;

export function toTimeline(trace: TraceEntry[], subscriptions: TimelineRow[]): TimelineModel {
  const rowOf = new Map(subscriptions.map((s, i) => [s.subscriptionId, i]));
  const owners = eventOwners(trace);
  const forgedIds = new Set<string>();
  const markers: TimelineMarker[] = [];
  const firstAttemptSeen = new Set<string>();
  const failedMarker = new Map<string, TimelineMarker>();

  const rowForEvent = (eventId: string): number | undefined => {
    const owner = owners.get(eventId);
    return owner === undefined ? undefined : rowOf.get(owner);
  };

  for (const t of trace) {
    if (t.kind === 'event') {
      const row = rowForEvent(t.event.id);
      if (row === undefined) continue;
      if (t.forged) {
        forgedIds.add(t.event.id);
        markers.push({ row, at: t.at, kind: 'forged', eventId: t.event.id });
        continue;
      }
      const kind = KIND_OF_EVENT[t.event.event_type];
      if (kind) markers.push({ row, at: t.at, kind, eventId: t.event.id });
    } else if (t.kind === 'delivery') {
      const row = rowForEvent(t.eventId);
      if (row === undefined) continue;
      if (t.attempt === 1) {
        if (firstAttemptSeen.has(t.eventId)) markers.push({ row, at: t.at, kind: 'duplicate', eventId: t.eventId });
        firstAttemptSeen.add(t.eventId);
      }
      // A forged notice the app rejects is the app doing its job, not a failed delivery.
      if (isFailedDelivery(t) && !forgedIds.has(t.eventId)) {
        const existing = failedMarker.get(t.eventId);
        if (existing) {
          existing.count = (existing.count ?? 1) + 1;
        } else {
          const marker: TimelineMarker = { row, at: t.at, kind: 'delivery_failed', eventId: t.eventId, count: 1 };
          failedMarker.set(t.eventId, marker);
          markers.push(marker);
        }
      }
    }
  }

  markers.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { rows: subscriptions.map(({ customer, subscriptionId }) => ({ customer, subscriptionId })), markers };
}
