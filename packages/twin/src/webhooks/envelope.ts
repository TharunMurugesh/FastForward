import type { EventType, WebhookEvent } from '@fastforward/contracts';
import { newId } from '../ids.js';
import type { DomainEvent } from '../subscriptions/events.js';

const EVENTS_BASE = 'https://api.sandbox.paypal.com/v1/notifications/webhooks-events/';

type Resource = Record<string, unknown>;

function amount(r: Resource): string {
  const a = r.amount as { total?: unknown; currency?: unknown } | undefined;
  return a && typeof a.total === 'string' && typeof a.currency === 'string' ? `$ ${a.total} ${a.currency}` : '';
}

/** The `summary` line PayPal writes for each event type. */
const SUMMARIES: Record<EventType, (r: Resource) => string> = {
  'BILLING.SUBSCRIPTION.CREATED': () => 'Subscription created',
  'BILLING.SUBSCRIPTION.ACTIVATED': () => 'Subscription activated',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED': () => 'Subscription payment failed',
  'BILLING.SUBSCRIPTION.SUSPENDED': () => 'Subscription suspended',
  'BILLING.SUBSCRIPTION.CANCELLED': () => 'Subscription cancelled',
  'BILLING.SUBSCRIPTION.EXPIRED': () => 'Subscription expired',
  'PAYMENT.SALE.COMPLETED': (r) => `Payment completed for ${amount(r)}`.trimEnd(),
  'CUSTOMER.DISPUTE.CREATED': (r) => `A new dispute opened with Case # ${String(r.dispute_id ?? '')}`.trimEnd(),
  'CUSTOMER.DISPUTE.UPDATED': (r) => `A dispute was updated with Case # ${String(r.dispute_id ?? '')}`.trimEnd(),
  'CUSTOMER.DISPUTE.RESOLVED': (r) => `A dispute was resolved with Case # ${String(r.dispute_id ?? '')}`.trimEnd(),
};

/** Wraps an engine's event in PayPal's webhook envelope (spec §6), stamped with virtual time `at`. */
export function toWebhookEvent(e: DomainEvent, at: Date): WebhookEvent {
  const id = newId('WH');
  return {
    id,
    event_version: '1.0',
    create_time: at.toISOString(),
    resource_type: e.resourceType,
    event_type: e.type,
    summary: SUMMARIES[e.type](e.resource),
    resource: e.resource,
    links: [
      { href: `${EVENTS_BASE}${id}`, rel: 'self', method: 'GET' },
      { href: `${EVENTS_BASE}${id}/resend`, rel: 'resend', method: 'POST' },
    ],
  };
}
