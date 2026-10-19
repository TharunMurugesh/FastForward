import type { CheckResult, Report, TraceEntry, WebhookEvent } from '@fastforward/contracts';

/**
 * A recorded-style run of examples/coffee-club/scenarios/bad-month.yaml against a buggy Coffee Club.
 * This is hand-written sample data in the contract types, shown only when no twin is reachable.
 * What it shows: Maya's payment delivered twice (and fulfilled twice), Leo's card failing and his
 * suspension notice arriving before the failure that caused it, Leo's app answering slowly, a forged
 * cancellation that the app rightly rejects, and Ana's dispute that nobody answers.
 */

export const START = '2026-11-01T00:00:00.000Z';
export const END = '2026-12-31T00:00:00.000Z';

export const SUBS = {
  Maya: 'I-4M7YB2K9XQ1T',
  Leo: 'I-9L3EO5RZ2W8C',
  Ana: 'I-6A1NA8HD4V0P',
} as const;

export const subscriptions = [
  { customer: 'Maya', subscriptionId: SUBS.Maya },
  { customer: 'Leo', subscriptionId: SUBS.Leo },
  { customer: 'Ana', subscriptionId: SUBS.Ana },
];

const at = (local: string, seconds = 0): string => new Date(Date.parse(`${local}:00.000Z`) + seconds * 1000).toISOString();

const trace: TraceEntry[] = [];
let eventCount = 0;
let sendCount = 0;

type Resource = Record<string, unknown>;

function emit(type: WebhookEvent['event_type'], when: string, resource: Resource, opts: { forged?: boolean; summary?: string } = {}): string {
  eventCount += 1;
  const id = `WH-${(0x5f3a00 + eventCount * 7919).toString(16).toUpperCase()}FF`;
  trace.push({
    at: when,
    kind: 'event',
    forged: opts.forged ?? false,
    event: {
      id,
      event_version: '1.0',
      create_time: when,
      resource_type: type.startsWith('PAYMENT') ? 'sale' : type.startsWith('CUSTOMER') ? 'dispute' : 'subscription',
      event_type: type,
      summary: opts.summary ?? type,
      resource,
      links: [{ href: `https://api.sandbox.paypal.com/v1/notifications/webhooks-events/${id}`, rel: 'self', method: 'GET' }],
    },
  });
  return id;
}

function send(
  eventId: string,
  when: string,
  o: { attempt?: number; status?: number | null; ms?: number; verified?: boolean; transmission?: string } = {},
): void {
  sendCount += 1;
  const transmissionId = o.transmission ?? `tx-${String(sendCount).padStart(4, '0')}-ff`;
  trace.push({
    at: when,
    kind: 'delivery',
    eventId,
    attempt: o.attempt ?? 1,
    status: o.status === undefined ? 200 : o.status,
    ms: o.ms ?? 38 + ((sendCount * 17) % 70),
    verifyCalled: o.verified ?? true,
    transmissionId,
  });
  if (o.verified ?? true) {
    trace.push({ at: when, kind: 'verify_call', transmissionId, result: o.status === 400 ? 'FAILURE' : 'SUCCESS' });
  }
}

const sub = (id: string, status: string): Resource => ({ id, status });
const sale = (id: string, agreement: string): Resource => ({
  id,
  state: 'completed',
  amount: { total: '12.00', currency: 'USD', details: { subtotal: '12.00' } },
  billing_agreement_id: agreement,
});

// 1 Nov: three customers subscribe. Maya's ACTIVATED notice is delayed 72 minutes, so it lands after her payment.
for (const name of ['Maya', 'Leo', 'Ana'] as const) {
  trace.push({ at: at('2026-11-01T00:00'), kind: 'app_call', method: 'POST', path: '/v1/billing/subscriptions', status: 201 });
  const s = SUBS[name];
  const created = emit('BILLING.SUBSCRIPTION.CREATED', at('2026-11-01T00:00'), sub(s, 'APPROVAL_PENDING'), { summary: `Subscription created for ${name}` });
  const activated = emit('BILLING.SUBSCRIPTION.ACTIVATED', at('2026-11-01T00:00'), sub(s, 'ACTIVE'), { summary: `Subscription activated for ${name}` });
  const paid = emit('PAYMENT.SALE.COMPLETED', at('2026-11-01T00:00'), sale(`SALE-${name.toUpperCase()}-1`, s), { summary: 'Payment completed for $12.00 USD' });
  send(created, at('2026-11-01T00:00', 1));
  send(paid, at('2026-11-01T00:00', 2));
  send(activated, name === 'Maya' ? at('2026-11-01T01:12') : at('2026-11-01T00:00', 1));
}

// 15 Nov: a forged cancellation for Maya. The app verifies it, PayPal's check says FAILURE, the app refuses.
const forged = emit('BILLING.SUBSCRIPTION.CANCELLED', at('2026-11-15T10:00'), sub(SUBS.Maya, 'CANCELLED'), {
  forged: true,
  summary: 'Subscription cancelled (forged)',
});
send(forged, at('2026-11-15T10:00', 1), { status: 400, ms: 52 });

// 20 Nov: Ana opens a dispute. Nobody answers it.
export const DISPUTE_ID = 'PP-D-8841';
const disputeCreated = emit(
  'CUSTOMER.DISPUTE.CREATED',
  at('2026-11-20T09:00'),
  {
    dispute_id: DISPUTE_ID,
    reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
    status: 'WAITING_FOR_SELLER_RESPONSE',
    dispute_stage: 'INQUIRY',
    seller_response_due_date: at('2026-12-10T09:00'),
    disputed_transactions: [{ seller_transaction_id: 'SALE-ANA-1' }],
    messages: [{ posted_by: 'BUYER', time_posted: at('2026-11-20T09:00'), content: 'My first bag of coffee never arrived.' }],
  },
  { summary: 'A new dispute was opened' },
);
send(disputeCreated, at('2026-11-20T09:00', 2));

// 1 Dec: Maya's second payment is delivered twice (the duplicate); Ana pays again; Leo's card is declined.
const mayaSale2 = emit('PAYMENT.SALE.COMPLETED', at('2026-12-01T00:00'), sale('SALE-MAYA-2', SUBS.Maya), { summary: 'Payment completed for $12.00 USD' });
send(mayaSale2, at('2026-12-01T00:00', 2));
send(mayaSale2, at('2026-12-01T00:00', 44));
const anaSale2 = emit('PAYMENT.SALE.COMPLETED', at('2026-12-01T00:00'), sale('SALE-ANA-2', SUBS.Ana), { summary: 'Payment completed for $12.00 USD' });
send(anaSale2, at('2026-12-01T00:00', 3));

const leoFailed1 = emit('BILLING.SUBSCRIPTION.PAYMENT.FAILED', at('2026-12-01T00:00'), { ...sub(SUBS.Leo, 'ACTIVE'), failed_payments_count: 1 }, { summary: 'Payment failed on subscription' });
send(leoFailed1, at('2026-12-01T00:00', 1), { status: null, ms: 10000, transmission: 'tx-leo-failed-1' });
send(leoFailed1, at('2026-12-01T00:01', 1), { attempt: 2, status: null, ms: 10000, transmission: 'tx-leo-failed-1' });
send(leoFailed1, at('2026-12-01T00:03', 1), { attempt: 3, status: 200, ms: 9420, transmission: 'tx-leo-failed-1' });
trace.push({ at: at('2026-12-01T00:00', 5), kind: 'customer_decision', customer: 'Leo', decision: { action: 'ignore' } });

// 6 Dec: Leo's retry fails and the subscription is suspended. The notices are reordered: SUSPENDED arrives first.
const leoFailed2 = emit('BILLING.SUBSCRIPTION.PAYMENT.FAILED', at('2026-12-06T00:00'), { ...sub(SUBS.Leo, 'ACTIVE'), failed_payments_count: 2 }, { summary: 'Payment failed on subscription' });
const leoSuspended = emit('BILLING.SUBSCRIPTION.SUSPENDED', at('2026-12-06T00:00'), sub(SUBS.Leo, 'SUSPENDED'), { summary: 'Subscription suspended' });
send(leoSuspended, at('2026-12-06T00:00', 1));
send(leoFailed2, at('2026-12-06T00:00', 2));
trace.push({ at: at('2026-12-06T00:00', 5), kind: 'customer_decision', customer: 'Leo', decision: { action: 'ignore' } });

// 10 Dec: the dispute's due date passes unanswered and PayPal rules for the buyer.
const disputeResolved = emit(
  'CUSTOMER.DISPUTE.RESOLVED',
  at('2026-12-10T09:00'),
  { dispute_id: DISPUTE_ID, status: 'RESOLVED', dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR' } },
  { summary: 'A dispute was resolved' },
);
send(disputeResolved, at('2026-12-10T09:00', 1));

// Checkpoints (one per virtual day with deliveries; only the interesting days are kept in the sample).
const probe = (when: string, customer: keyof typeof SUBS, access: boolean | null, fulfilments: number | null, expectedAccess: boolean, completedPayments: number): void => {
  trace.push({ at: when, kind: 'probe', subscriptionId: SUBS[customer], access, fulfilments, expectedAccess, completedPayments });
};
probe(at('2026-11-01T23:59'), 'Maya', true, 1, true, 1);
probe(at('2026-11-15T23:59'), 'Maya', true, 1, true, 1);
probe(at('2026-12-01T23:59'), 'Maya', true, 3, true, 2);
probe(at('2026-12-01T23:59'), 'Leo', true, 1, true, 1);
probe(at('2026-12-06T23:59'), 'Leo', true, 1, false, 1);
probe(at('2026-12-31T00:00'), 'Leo', true, 1, false, 1);

trace.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

const eventIds = {
  mayaSale2,
  leoFailed1,
  leoSuspended,
  disputeCreated,
};

const checks: CheckResult[] = [
  {
    id: 'ACK_FAST',
    status: 'fail',
    findings: [
      {
        at: at('2026-12-01T00:00', 1),
        summary: "Leo's payment-failed notice took 10 s or more on 3 attempts out of 3 and was only accepted on the third",
        eventIds: [eventIds.leoFailed1],
        explanation:
          "PayPal waits 10 seconds for an answer. Your app took that long (twice it never answered in time), so PayPal treated each try as lost and sent the notice again at 1 minute and 3 minutes. The third answer arrived in 9.4 s, which only just made it.",
        fix: 'Reply 200 immediately and do the slow work (emails, database updates) after replying, from a queue.',
      },
    ],
  },
  { id: 'VERIFIES_SIGNATURES', status: 'pass', findings: [] },
  {
    id: 'STATE_MATCHES',
    status: 'fail',
    findings: [
      {
        at: at('2026-12-06T23:59'),
        summary: "Leo still has access on 6 Dec although his subscription is SUSPENDED",
        eventIds: [eventIds.leoSuspended],
        explanation:
          "Leo's card failed twice, so PayPal suspended his subscription and sent a suspension notice. Your app received it (the grid shows a 200) but never switched his access off, so he keeps getting coffee without paying.",
        fix: 'Handle BILLING.SUBSCRIPTION.SUSPENDED the same way as a cancellation: switch access off until a later payment succeeds.',
      },
    ],
  },
  {
    id: 'FULFIL_ONCE',
    status: 'fail',
    findings: [
      {
        at: at('2026-12-01T23:59'),
        summary: "Maya's 1 Dec payment was fulfilled twice (3 fulfilments for 2 payments)",
        eventIds: [eventIds.mayaSale2],
        explanation:
          'PayPal delivered the same payment notice twice (same event id, 42 seconds apart). Your app treated each copy as a new payment and shipped Maya a second bag for one charge. PayPal can send a notice more than once, by design.',
        fix: "Store the id of every notice you have handled and ignore any id you've seen before.",
      },
    ],
  },
  {
    id: 'DISPUTE_ANSWERED',
    status: 'fail',
    findings: [
      {
        at: at('2026-12-10T09:00'),
        summary: `Ana's dispute ${DISPUTE_ID} got no seller response before its due date (10 Dec)`,
        eventIds: [eventIds.disputeCreated],
        explanation:
          'Ana said her first bag never arrived and opened a dispute. Your app acknowledged the notice but sent no evidence or message, so on the due date PayPal ruled in her favour and the $12.00 stays with her.',
        fix: 'When a dispute-created notice arrives, send tracking details through the disputes API (provide-evidence), or alert a person before the due date.',
      },
    ],
  },
  { id: 'NO_LIVE_CALLS', status: 'pass', findings: [] },
];

export const badMonth = {
  runId: 'sample-bad-month',
  scenario: 'bad-month',
  start: START,
  end: END,
  subscriptions,
  trace,
  eventIds,
  report: {
    runId: 'sample-bad-month',
    scenario: 'bad-month',
    start: START,
    end: END,
    checks,
    counts: {
      events: trace.filter((t) => t.kind === 'event').length,
      deliveries: trace.filter((t) => t.kind === 'delivery').length,
      customers: subscriptions.length,
    },
  } satisfies Report,
};
