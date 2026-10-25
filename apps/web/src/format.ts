import type { AiSummary, CheckId, ExplanationSource, Report } from '@fastforward/contracts';

const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dateYear = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' });

/** Virtual timestamps are shown in UTC so a run reads the same on every machine. */
export const fmtDate = (iso: string): string => date.format(new Date(iso));
export const fmtDateYear = (iso: string): string => dateYear.format(new Date(iso));
export const fmtDateTime = (iso: string): string => `${date.format(new Date(iso))} ${time.format(new Date(iso))}`;

export const CHECK_TITLES: Record<CheckId, string> = {
  ACK_FAST: 'App answers PayPal fast',
  VERIFIES_SIGNATURES: 'App verifies each notice is from PayPal',
  STATE_MATCHES: 'Access matches the subscription status',
  FULFIL_ONCE: 'Each payment is fulfilled once',
  DISPUTE_ANSWERED: 'Disputes are answered in time',
  NO_LIVE_CALLS: 'No calls to live PayPal',
};

/** `BILLING.SUBSCRIPTION.PAYMENT.FAILED` is hard to scan; the grid shows it as-is and the inspector adds this. */
export const EVENT_LABELS: Record<string, string> = {
  'BILLING.SUBSCRIPTION.CREATED': 'Subscription created',
  'BILLING.SUBSCRIPTION.ACTIVATED': 'Subscription activated',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': 'Payment failed',
  'BILLING.SUBSCRIPTION.SUSPENDED': 'Subscription suspended',
  'BILLING.SUBSCRIPTION.CANCELLED': 'Subscription cancelled',
  'BILLING.SUBSCRIPTION.EXPIRED': 'Subscription expired',
  'PAYMENT.SALE.COMPLETED': 'Payment completed',
  'CUSTOMER.DISPUTE.CREATED': 'Dispute opened',
  'CUSTOMER.DISPUTE.UPDATED': 'Dispute updated',
  'CUSTOMER.DISPUTE.RESOLVED': 'Dispute resolved',
};

/** Coffee Club's switchable bugs in plain words, for naming what was on in a recorded run. */
export const BUG_LABELS: Record<string, string> = {
  'no-verify': 'does not verify signatures',
  'no-dedupe': 'handles a repeated notice twice',
  'slow-ack': 'answers slowly',
  'ignores-suspend': 'ignores suspensions',
  'ignores-disputes': 'ignores disputes',
  'trusts-event-order': 'trusts the order notices arrive in',
};

/** Short plain-words labels for the grid chips; the full title and the id are in the hover text. */
export const CHECK_SHORT: Record<CheckId, string> = {
  ACK_FAST: 'slow answer',
  VERIFIES_SIGNATURES: 'unverified',
  STATE_MATCHES: 'wrong access',
  FULFIL_ONCE: 'paid twice',
  DISPUTE_ANSWERED: 'dispute ignored',
  NO_LIVE_CALLS: 'live call',
};

// Copies of describeAi and explanationLabel from the contracts package. The dashboard imports only types from there, so
// its bundle stays free of the scenario parser; test/ai-text.test.ts fails if these drift from the shared wording.

/** One sentence on how much of a run the model did, and whether it ran now or was replayed from a recording. */
export function describeAi(ai: AiSummary): string {
  const did = `${ai.customerDecisions.model} of ${ai.customerDecisions.total} customer decisions and ${ai.explanations.model} of ${ai.explanations.total} explanations`;
  const calls = ai.calls ?? 0;
  const tokens = ((ai.inputTokens ?? 0) + (ai.outputTokens ?? 0)).toLocaleString('en-US');
  const used = calls > 0 ? `${calls} model ${calls === 1 ? 'call' : 'calls'}, ${tokens} tokens` : 'no model calls now, replayed from a recording';
  return `${ai.model} wrote ${did} (${used})`;
}

/** Who wrote an explanation, in words for a reader; null when the report does not say. */
export function explanationLabel(source: ExplanationSource | undefined): string | null {
  if (source === 'model') return 'Written by Claude';
  if (source === 'template') return 'Built-in text';
  return null;
}

const many = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more}`;

/** One line on what was played: scenario, length, customers, notices and deliveries. */
export function runSummary(report: Pick<Report, 'scenario' | 'start' | 'end' | 'counts'>): string {
  const days = Math.round((Date.parse(report.end) - Date.parse(report.start)) / 86_400_000);
  return [
    report.scenario,
    many(days, 'simulated day', 'simulated days'),
    many(report.counts.customers, 'customer', 'customers'),
    many(report.counts.events, 'notice', 'notices'),
    many(report.counts.deliveries, 'delivery', 'deliveries'),
  ].join(' · ');
}

/** Known differences grouped by reason, so a reason that covers several fields is said once. */
export function groupKnownDiffs(diffs: { field: string; reason: string }[]): { fields: string[]; reason: string }[] {
  const groups: { fields: string[]; reason: string }[] = [];
  for (const d of diffs) {
    const g = groups.find((x) => x.reason === d.reason);
    if (g) g.fields.push(d.field);
    else groups.push({ fields: [d.field], reason: d.reason });
  }
  return groups;
}
