import type { Report, TraceEntry, WebhookEvent } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { badMonth } from '../src/fixtures/bad-month.js';
import { toDeliveryRows } from '../src/grids/rows.js';
import { disputeThreads } from '../src/panels/thread.js';

const subs = [
  { customer: 'Maya', subscriptionId: 'I-MAYA' },
  { customer: 'Leo', subscriptionId: 'I-LEO' },
];

const event = (id: string, type: WebhookEvent['event_type'], resource: Record<string, unknown>, forged = false): TraceEntry => ({
  at: '2026-11-01T00:00:00.000Z',
  kind: 'event',
  forged,
  event: { id, event_version: '1.0', create_time: '2026-11-01T00:00:00.000Z', resource_type: 'x', event_type: type, summary: type, resource, links: [] },
});
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
const sale = event('E1', 'PAYMENT.SALE.COMPLETED', { id: 'S1', billing_agreement_id: 'I-LEO' });

const report = (checks: Report['checks']): Report => ({
  runId: 'r',
  scenario: 's',
  start: '2026-11-01T00:00:00.000Z',
  end: '2026-12-01T00:00:00.000Z',
  checks,
  counts: { events: 1, deliveries: 1, customers: 2 },
});

describe('toDeliveryRows', () => {
  it('carries customer name, event type and delivery facts', () => {
    const rows = toDeliveryRows([sale, delivery('E1', { status: 200, ms: 61 })], subs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      customer: 'Leo',
      eventType: 'PAYMENT.SALE.COMPLETED',
      eventId: 'E1',
      attempt: 1,
      status: 200,
      ms: 61,
      verified: true,
      duplicate: false,
      forged: false,
      failedChecks: [],
    });
  });

  it('retry attempts of one event become separate rows with attempt numbers', () => {
    const rows = toDeliveryRows([sale, delivery('E1', { status: null, ms: 10000 }), delivery('E1', { attempt: 2 }), delivery('E1', { attempt: 3 })], subs);
    expect(rows.map((r) => r.attempt)).toEqual([1, 2, 3]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
    expect(rows.every((r) => !r.duplicate)).toBe(true);
  });

  it('marks a second delivery of the same id as duplicate, and its retries too', () => {
    const rows = toDeliveryRows(
      [
        sale,
        delivery('E1', { transmissionId: 'tx-a' }),
        delivery('E1', { transmissionId: 'tx-b', status: 500 }),
        delivery('E1', { transmissionId: 'tx-b', attempt: 2 }),
      ],
      subs,
    );
    expect(rows.map((r) => r.duplicate)).toEqual([false, true, true]);
  });

  it('flags forged events', () => {
    const rows = toDeliveryRows([event('F1', 'BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-MAYA' }, true), delivery('F1', { status: 400 })], subs);
    expect(rows[0]).toMatchObject({ forged: true, customer: 'Maya', status: 400 });
  });

  it('delivery rows carry failed check ids from the report', () => {
    const rows = toDeliveryRows(
      [sale, delivery('E1')],
      subs,
      report([
        { id: 'FULFIL_ONCE', status: 'fail', findings: [{ at: '', summary: '', eventIds: ['E1'] }] },
        { id: 'STATE_MATCHES', status: 'fail', findings: [{ at: '', summary: '', eventIds: ['E-OTHER'] }] },
        { id: 'NO_LIVE_CALLS', status: 'pass', findings: [] },
      ]),
    );
    expect(rows[0]?.failedChecks).toEqual(['FULFIL_ONCE']);
  });

  it('attaches ACK_FAST only to the deliveries that were actually slow or failed', () => {
    const rows = toDeliveryRows(
      [sale, delivery('E1', { status: null, ms: 10000 }), delivery('E1', { attempt: 2, status: 200, ms: 30 })],
      subs,
      report([{ id: 'ACK_FAST', status: 'fail', findings: [{ at: '', summary: '', eventIds: ['E1'] }] }]),
    );
    expect(rows.map((r) => r.failedChecks)).toEqual([['ACK_FAST'], []]);
  });

  it('uses a dash for events whose customer is unknown', () => {
    const rows = toDeliveryRows([event('E9', 'PAYMENT.SALE.COMPLETED', { id: 'S9', billing_agreement_id: 'I-NOPE' }), delivery('E9')], subs);
    expect(rows[0]?.customer).toBe('—');
  });

  it('skips deliveries whose event is not in the trace yet', () => {
    expect(toDeliveryRows([delivery('E-GONE')], subs)).toEqual([]);
  });
});

describe('bad-month fixture rows', () => {
  const rows = toDeliveryRows(badMonth.trace, badMonth.subscriptions, badMonth.report);
  it('has failing, duplicate and forged rows', () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.failedChecks.length > 0)).toBe(true);
    expect(rows.some((r) => r.duplicate)).toBe(true);
    expect(rows.some((r) => r.forged)).toBe(true);
  });
  it("names every row's customer, so no event was left without an owner", () => {
    const names = new Set(badMonth.subscriptions.map((s) => s.customer));
    expect(rows.filter((r) => !names.has(r.customer))).toEqual([]);
  });
  it('ties each failing check of the report to at least one row', () => {
    const ids = new Set(rows.flatMap((r) => r.failedChecks));
    for (const c of badMonth.report.checks.filter((c) => c.status === 'fail')) expect(ids).toContain(c.id);
  });
});

describe('disputeThreads', () => {
  it('builds the conversation from the real dispute events', () => {
    const threads = disputeThreads(badMonth.trace, badMonth.subscriptions);
    const opened = badMonth.trace.find((t) => t.kind === 'event' && t.event.event_type === 'CUSTOMER.DISPUTE.CREATED');
    expect(opened).toBeDefined();
    expect(threads).toHaveLength(1);
    const t = threads[0]!;
    expect(t.disputeId).toBe((opened as unknown as { event: { resource: { dispute_id: string } } }).event.resource.dispute_id);
    expect(t.customer).toBe('Ana'); // the scenario's dispute action belongs to Ana
    expect(t.messages[0]).toMatchObject({ from: 'system' });
    expect(t.messages.some((m) => m.from === 'buyer' && m.text.includes('never arrived'))).toBe(true);
    expect(t.messages.at(-1)).toMatchObject({ from: 'system' });
    expect(t.messages.at(-1)?.text).toMatch(/buyer/i);
  });

  it('shows seller actions as the seller speaking', () => {
    const trace: TraceEntry[] = [
      event('D1', 'CUSTOMER.DISPUTE.CREATED', { dispute_id: 'PP-D-1', reason: 'OTHER', disputed_transactions: [{ seller_transaction_id: 'S1' }] }),
      sale,
      { at: '2026-11-02T00:00:00.000Z', kind: 'dispute_action', disputeId: 'PP-D-1', action: 'provide-evidence' },
    ];
    const t = disputeThreads(trace, subs)[0]!;
    expect(t.messages.some((m) => m.from === 'seller' && /evidence/i.test(m.text))).toBe(true);
  });
});
