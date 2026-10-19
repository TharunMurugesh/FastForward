import type { Report, TraceEntry, WebhookEvent } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { badMonth } from '../src/fixtures/bad-month.js';
import { toDeliveryRows, toNoticeRows } from '../src/grids/rows.js';
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


describe('retry chains in real traces (each retry has its own transmission id)', () => {
  const tx = (n: number) => ({ transmissionId: `tx-${n}` });
  const at = (s: number) => `2026-11-01T00:00:${String(s).padStart(2, '0')}.000Z`;

  it('attributes interleaved retries to the right copy, so a duplicate copy is marked on every attempt', () => {
    const rows = toDeliveryRows(
      [
        sale,
        delivery('E1', { ...tx(1), attempt: 1, status: null, ms: 10000, at: at(1) }), // copy 0
        delivery('E1', { ...tx(2), attempt: 1, status: null, ms: 10000, at: at(2) }), // copy 1 (the duplicate)
        delivery('E1', { ...tx(3), attempt: 2, status: null, ms: 10000, at: at(3) }), // copy 0
        delivery('E1', { ...tx(4), attempt: 2, status: 200, ms: 20, at: at(4) }), // copy 1
        delivery('E1', { ...tx(5), attempt: 3, status: 200, ms: 20, at: at(5) }), // copy 0: copy 1 already finished
      ],
      subs,
    );
    expect(rows.map((r) => [r.copy, r.duplicate])).toEqual([
      [0, false],
      [1, true],
      [0, false],
      [1, true],
      [0, false],
    ]);
  });
});

describe('toNoticeRows', () => {
  const at = (s: number) => `2026-11-01T00:00:${String(s).padStart(2, '0')}.000Z`;
  const failing = (n: number) => delivery('E1', { transmissionId: `t${n}`, attempt: n, status: null, ms: 10000, at: at(n) });
  const checks = (...ids: Array<'ACK_FAST' | 'FULFIL_ONCE'>): Report =>
    report(ids.map((id) => ({ id, status: 'fail' as const, findings: [{ at: '', summary: '', eventIds: ['E1'] }] })));

  it('turns many attempts of one notice into one row: last outcome, tries, worst status, first time', () => {
    const rows = toDeliveryRows([sale, failing(1), failing(2), delivery('E1', { transmissionId: 't3', attempt: 3, status: 200, ms: 31, at: at(3) })], subs);
    const notices = toNoticeRows(rows);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({
      eventId: 'E1',
      customer: 'Leo',
      tries: 3,
      status: 200, // the last attempt's outcome
      ms: 31,
      worstStatus: null, // a timeout is the worst thing that happened
      at: at(1), // when the notice first went out
      duplicate: false,
    });
  });

  it('worst status is the highest error code when nothing timed out, else the last answer', () => {
    const mixed = toNoticeRows(
      toDeliveryRows([sale, delivery('E1', { transmissionId: 'a', attempt: 1, status: 500 }), delivery('E1', { transmissionId: 'b', attempt: 2, status: 503 }), delivery('E1', { transmissionId: 'c', attempt: 3, status: 200 })], subs),
    );
    expect(mixed[0]).toMatchObject({ worstStatus: 503, status: 200, tries: 3 });
    const clean = toNoticeRows(toDeliveryRows([sale, delivery('E1')], subs));
    expect(clean[0]).toMatchObject({ worstStatus: 200, tries: 1 });
  });

  it('unions the failing checks of every attempt', () => {
    const rows = toDeliveryRows([sale, failing(1), delivery('E1', { transmissionId: 't2', attempt: 2, status: 200, ms: 5, at: at(2) })], subs, checks('ACK_FAST', 'FULFIL_ONCE'));
    // ACK_FAST attaches to the failed attempt only, FULFIL_ONCE to both; the notice carries both once.
    expect(rows.map((r) => r.failedChecks)).toEqual([['ACK_FAST', 'FULFIL_ONCE'], ['FULFIL_ONCE']]);
    expect(toNoticeRows(rows)[0]?.failedChecks).toEqual(['ACK_FAST', 'FULFIL_ONCE']);
  });

  it('a duplicate copy is its own row, marked duplicate, with its own tries', () => {
    const rows = toDeliveryRows(
      [
        sale,
        delivery('E1', { transmissionId: 'a1', attempt: 1, status: 500, at: at(1) }),
        delivery('E1', { transmissionId: 'b1', attempt: 1, status: 200, at: at(2) }),
        delivery('E1', { transmissionId: 'a2', attempt: 2, status: 200, at: at(3) }),
      ],
      subs,
    );
    const notices = toNoticeRows(rows);
    expect(notices.map((n) => [n.duplicate, n.tries, n.status])).toEqual([
      [false, 2, 200],
      [true, 1, 200],
    ]);
    expect(new Set(notices.map((n) => n.id)).size).toBe(2);
  });

  it('is signature-checked when any attempt checked it, and keeps forged and customer', () => {
    const rows = toDeliveryRows(
      [event('F1', 'BILLING.SUBSCRIPTION.CANCELLED', { id: 'I-MAYA' }, true), delivery('F1', { transmissionId: 'x', verifyCalled: false, status: 500 }), delivery('F1', { transmissionId: 'y', attempt: 2, verifyCalled: true, status: 400 })],
      subs,
    );
    expect(toNoticeRows(rows)[0]).toMatchObject({ verified: true, forged: true, customer: 'Maya', worstStatus: 500, status: 400 });
  });

  it('keeps the order notices first went out in', () => {
    const second = event('E2', 'BILLING.SUBSCRIPTION.SUSPENDED', { id: 'I-LEO' });
    const rows = toDeliveryRows([sale, second, delivery('E2', { transmissionId: 'p', at: at(1) }), delivery('E1', { transmissionId: 'q', at: at(2) })], subs);
    expect(toNoticeRows(rows).map((n) => n.eventId)).toEqual(['E2', 'E1']);
  });
});

describe('bad-month fixture notices', () => {
  const attempts = toDeliveryRows(badMonth.trace, badMonth.subscriptions, badMonth.report);
  const notices = toNoticeRows(attempts);
  it('has no more rows than attempts, and every notice is accounted for', () => {
    expect(notices.length).toBeLessThanOrEqual(attempts.length);
    expect(notices.reduce((sum, n) => sum + n.tries, 0)).toBe(attempts.length);
  });
  it('keeps duplicate copies and forged notices visible', () => {
    expect(notices.some((n) => n.duplicate)).toBe(true);
    expect(notices.some((n) => n.forged)).toBe(true);
  });
});
