import type { CheckId } from '@fastforward/contracts';

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
