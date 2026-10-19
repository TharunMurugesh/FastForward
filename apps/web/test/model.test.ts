import type { TraceEntry, WebhookEvent } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { badMonth } from '../src/fixtures/bad-month.js';
import { toTimeline } from '../src/timeline/model.js';

const subs = [
  { customer: 'Maya', subscriptionId: 'I-MAYA' },
  { customer: 'Leo', subscriptionId: 'I-LEO' },
];

function event(id: string, type: WebhookEvent['event_type'], resource: Record<string, unknown>, at = '2026-11-01T00:00:00.000Z', forged = false): TraceEntry {
  return {
    at,
    kind: 'event',
    forged,
    event: { id, event_version: '1.0', create_time: at, resource_type: 'x', event_type: type, summary: type, resource, links: [] },
  };
}
const delivery = (eventId: string, o: Partial<Extract<TraceEntry, { kind: 'delivery' }>> = {}): TraceEntry => ({
  at: '2026-11-01T00:00:02.000Z',
  kind: 'delivery',
  eventId,
  attempt: 1,
  status: 200,
  ms: 40,
  verifyCalled: true,
  transmissionId: 'tx-1',
  ...o,
});

describe('toTimeline', () => {
  it('maps SALE.COMPLETED to payment_ok on the right row', () => {
    const model = toTimeline([event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-LEO' })], subs);
    expect(model.rows).toEqual(subs);
    expect(model.markers).toEqual([{ row: 1, at: '2026-11-01T00:00:00.000Z', kind: 'payment_ok', eventId: 'E1' }]);
  });

  it('maps failure, suspension, cancellation and expiry kinds', () => {
    const resource = { id: 'I-MAYA' };
    const kinds = toTimeline(
      [
        event('E1', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', resource),
        event('E2', 'BILLING.SUBSCRIPTION.SUSPENDED', resource),
        event('E3', 'BILLING.SUBSCRIPTION.CANCELLED', resource),
        event('E4', 'BILLING.SUBSCRIPTION.EXPIRED', resource),
      ],
      subs,
    ).markers.map((m) => m.kind);
    expect(kinds).toEqual(['payment_failed', 'suspended', 'cancelled', 'expired']);
  });

  it('does not draw markers for CREATED and ACTIVATED', () => {
    const model = toTimeline([event('E1', 'BILLING.SUBSCRIPTION.CREATED', { id: 'I-MAYA' }), event('E2', 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-MAYA' })], subs);
    expect(model.markers).toEqual([]);
  });

  it('forged events get kind forged, on the subscription they claim to affect, and no failed-delivery marker', () => {
    const model = toTimeline(
      [event('E1', 'BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-MAYA' }, '2026-11-01T00:00:00.000Z', true), delivery('E1', { status: 400 })],
      subs,
    );
    expect(model.markers.map((m) => [m.row, m.kind])).toEqual([[0, 'forged']]);
  });

  it('marks a second first-attempt delivery of the same id as duplicate', () => {
    const model = toTimeline(
      [
        event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-MAYA' }),
        delivery('E1', { transmissionId: 'tx-a' }),
        delivery('E1', { transmissionId: 'tx-b', at: '2026-11-01T00:00:40.000Z' }),
      ],
      subs,
    );
    expect(model.markers.map((m) => m.kind)).toEqual(['payment_ok', 'duplicate']);
    expect(model.markers[1]).toMatchObject({ row: 0, eventId: 'E1', at: '2026-11-01T00:00:40.000Z' });
  });

  it('a retry (attempt 2) is not a duplicate', () => {
    const model = toTimeline(
      [event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-MAYA' }), delivery('E1', { status: 500 }), delivery('E1', { attempt: 2 })],
      subs,
    );
    expect(model.markers.map((m) => m.kind)).toEqual(['payment_ok', 'delivery_failed']);
  });

  it('failed delivery (status null) adds delivery_failed', () => {
    const model = toTimeline(
      [event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-MAYA' }), delivery('E1', { status: null, ms: 10000 })],
      subs,
    );
    expect(model.markers.map((m) => m.kind)).toEqual(['payment_ok', 'delivery_failed']);
  });

  it('puts dispute events on the subscription that owns the disputed sale', () => {
    const model = toTimeline(
      [
        event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-LEO' }),
        event('E2', 'CUSTOMER.DISPUTE.CREATED', { dispute_id: 'D1', disputed_transactions: [{ seller_transaction_id: 'S1' }] }),
      ],
      subs,
    );
    expect(model.markers.map((m) => [m.row, m.kind])).toEqual([
      [1, 'payment_ok'],
      [1, 'dispute'],
    ]);
  });

  it('drops events that belong to no known subscription', () => {
    expect(toTimeline([event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-NOBODY' })], subs).markers).toEqual([]);
  });

  it('orders markers by time', () => {
    const model = toTimeline(
      [
        event('E2', 'BILLING.SUBSCRIPTION.SUSPENDED', { id: 'I-MAYA' }, '2026-12-06T00:00:00.000Z'),
        event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-MAYA' }, '2026-11-01T00:00:00.000Z'),
      ],
      subs,
    );
    expect(model.markers.map((m) => m.eventId)).toEqual(['E1', 'E2']);
  });
});

describe('bad-month fixture', () => {
  it('shows every marker kind the story promises', () => {
    const kinds = new Set(toTimeline(badMonth.trace, badMonth.subscriptions).markers.map((m) => m.kind));
    for (const k of ['payment_ok', 'payment_failed', 'suspended', 'dispute', 'forged', 'duplicate', 'delivery_failed']) expect(kinds).toContain(k);
  });
});
