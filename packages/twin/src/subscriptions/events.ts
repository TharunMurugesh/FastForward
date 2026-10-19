import type { EventType } from '@fastforward/contracts';

/**
 * What an engine reports when something happens, before it is wrapped into a signed webhook
 * envelope (`WebhookEvent`) by the dispatcher.
 */
export interface DomainEvent {
  type: EventType;
  resourceType: 'subscription' | 'sale' | 'dispute';
  resource: Record<string, unknown>;
}
