import type { CheckId, EventType, Report, TraceEntry } from '@fastforward/contracts';
import { eventOwners, isFailedDelivery, type TimelineRow } from '../timeline/model.js';

export interface DeliveryRow {
  /** Unique per delivery attempt: `<eventId>#<n>`. */
  id: string;
  /** Virtual time of the attempt. */
  at: string;
  customer: string;
  eventType: EventType;
  eventId: string;
  attempt: number;
  status: number | null;
  ms: number;
  /** The app checked the signature during this delivery. */
  verified: boolean;
  /** This delivery is a second copy of an event already delivered once. */
  duplicate: boolean;
  forged: boolean;
  failedChecks: CheckId[];
}

/** The 10 s acknowledgement limit from spec section 7. */
export const ACK_LIMIT_MS = 10_000;

export const isSlowOrFailed = (d: { status: number | null; ms: number }): boolean => isFailedDelivery(d) || d.ms > ACK_LIMIT_MS;

export const isFailing = (row: DeliveryRow): boolean => row.failedChecks.length > 0;

/** One row per delivery attempt, newest information last. `report` supplies which checks each row is evidence for. */
export function toDeliveryRows(trace: TraceEntry[], subscriptions: TimelineRow[], report?: Report): DeliveryRow[] {
  const nameOf = new Map(subscriptions.map((s) => [s.subscriptionId, s.customer]));
  const owners = eventOwners(trace);
  const events = new Map<string, { type: EventType; forged: boolean }>();
  for (const t of trace) if (t.kind === 'event') events.set(t.event.id, { type: t.event.event_type, forged: t.forged });

  const failingChecks = (report?.checks ?? []).filter((c) => c.status === 'fail');
  const attemptsOfEvent = new Map<string, number>();
  const firstAttemptSeen = new Set<string>();
  const duplicateTransmission = new Map<string, boolean>();
  const rows: DeliveryRow[] = [];

  for (const t of trace) {
    if (t.kind !== 'delivery') continue;
    const event = events.get(t.eventId);
    if (!event) continue;

    let duplicate: boolean;
    if (t.attempt === 1) {
      duplicate = firstAttemptSeen.has(t.eventId);
      firstAttemptSeen.add(t.eventId);
      duplicateTransmission.set(t.transmissionId, duplicate);
    } else {
      duplicate = duplicateTransmission.get(t.transmissionId) ?? false;
    }

    const n = attemptsOfEvent.get(t.eventId) ?? 0;
    attemptsOfEvent.set(t.eventId, n + 1);

    const failedChecks = failingChecks
      .filter((c) => c.findings.some((f) => f.eventIds.includes(t.eventId)))
      .filter((c) => c.id !== 'ACK_FAST' || isSlowOrFailed(t))
      .map((c) => c.id);

    const owner = owners.get(t.eventId);
    rows.push({
      id: `${t.eventId}#${n}`,
      at: t.at,
      customer: (owner && nameOf.get(owner)) || '—',
      eventType: event.type,
      eventId: t.eventId,
      attempt: t.attempt,
      status: t.status,
      ms: t.ms,
      verified: t.verifyCalled,
      duplicate,
      forged: event.forged,
      failedChecks,
    });
  }
  return rows;
}
