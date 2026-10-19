import type { Scenario, TraceEntry, WebhookEvent } from '@fastforward/contracts';

type Of<K extends TraceEntry['kind']> = Extract<TraceEntry, { kind: K }>;

/** The trace sliced and indexed once, shared by every check. */
export interface CheckContext {
  scenario: Scenario;
  events: Of<'event'>[];
  eventById: Map<string, WebhookEvent>;
  deliveries: Of<'delivery'>[];
  probes: Of<'probe'>[];
  disputeActions: Of<'dispute_action'>[];
  verifyCalls: Of<'verify_call'>[];
  certFetches: Of<'cert_fetch'>[];
  liveCalls: Of<'live_call_blocked'>[];
  /** A readable name for a subscription: the scenario customer it belongs to, else its id. */
  customerOf(subscriptionId: string): string;
  /** PayPal's status for a subscription at a moment, from genuine (not forged) notices. */
  statusAt(subscriptionId: string, at: string): { status: string; eventId: string } | null;
}

export const day = (iso: string): string => iso.slice(0, 10);

function subscriptionIdOf(resource: Record<string, unknown>): string | null {
  if (typeof resource.billing_agreement_id === 'string') return resource.billing_agreement_id; // a sale
  if (typeof resource.id === 'string' && typeof resource.plan_id === 'string') return resource.id; // a subscription
  return null;
}

export function buildContext(trace: TraceEntry[], scenario: Scenario): CheckContext {
  const pick = <K extends TraceEntry['kind']>(kind: K): Of<K>[] => trace.filter((t): t is Of<K> => t.kind === kind);
  const events = pick('event');
  const eventById = new Map(events.map((e) => [e.event.id, e.event]));

  // custom_id on a subscription is what the app (or the twin) stored to say who the subscriber is.
  const customIds = new Map<string, string>();
  const statuses = new Map<string, { at: number; status: string; eventId: string }[]>();
  for (const { at, event, forged } of events) {
    if (forged) continue;
    const subId = subscriptionIdOf(event.resource);
    if (!subId) continue;
    const customId = event.resource.custom_id;
    if (typeof customId === 'string') customIds.set(subId, customId);
    const status = event.resource.status;
    if (typeof status === 'string' && event.resource.id === subId) {
      const list = statuses.get(subId) ?? [];
      list.push({ at: Date.parse(at), status, eventId: event.id });
      statuses.set(subId, list);
    }
  }

  const lower = (s: string) => s.trim().toLowerCase();
  return {
    scenario,
    events,
    eventById,
    deliveries: pick('delivery'),
    probes: pick('probe'),
    disputeActions: pick('dispute_action'),
    verifyCalls: pick('verify_call'),
    certFetches: pick('cert_fetch'),
    liveCalls: pick('live_call_blocked'),
    customerOf(subscriptionId) {
      const customId = customIds.get(subscriptionId);
      if (customId === undefined) return subscriptionId;
      const match = scenario.customers.find((c) => lower(c.name) === lower(customId) || lower(c.email) === lower(customId));
      return match?.name ?? customId;
    },
    statusAt(subscriptionId, at) {
      const t = Date.parse(at);
      let found: { status: string; eventId: string } | null = null;
      for (const s of statuses.get(subscriptionId) ?? []) if (s.at <= t) found = { status: s.status, eventId: s.eventId };
      return found;
    },
  };
}
