import type { DisputeReason } from './scenario.js';

export const EVENT_TYPES = [
  'BILLING.SUBSCRIPTION.CREATED',
  'BILLING.SUBSCRIPTION.ACTIVATED',
  'BILLING.SUBSCRIPTION.PAYMENT.FAILED',
  'BILLING.SUBSCRIPTION.SUSPENDED',
  'BILLING.SUBSCRIPTION.CANCELLED',
  'BILLING.SUBSCRIPTION.EXPIRED',
  'PAYMENT.SALE.COMPLETED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface WebhookEvent {
  id: string;
  event_version: '1.0';
  create_time: string;
  resource_type: string;
  event_type: EventType;
  summary: string;
  resource: Record<string, unknown>;
  links: { href: string; rel: string; method: string }[];
}

export type CustomerDecision =
  | { action: 'update_card' | 'ignore' | 'cancel' }
  | { action: 'dispute'; reason: DisputeReason; message: string }
  | { action: 'reply'; message: string };
