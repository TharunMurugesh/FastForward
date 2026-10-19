import type { CheckId, EventType, Report, TraceEntry } from '@fastforward/contracts';
import { CHECK_TITLES } from '../format.js';
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
  /** 0 for the notice as first sent; 1, 2... for extra copies PayPal delivered of the same event. */
  copy: number;
  /** This delivery belongs to an extra copy of an event already delivered once. */
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
  // Per event, one entry per copy delivered: where its retry chain has got to. Retries get a transmission id
  // of their own, so a retry is matched to the copy whose previous attempt failed, not by id.
  const copiesOfEvent = new Map<string, { lastAttempt: number; lastFailed: boolean }[]>();
  const rows: DeliveryRow[] = [];

  for (const t of trace) {
    if (t.kind !== 'delivery') continue;
    const event = events.get(t.eventId);
    if (!event) continue;

    const copies = copiesOfEvent.get(t.eventId) ?? [];
    copiesOfEvent.set(t.eventId, copies);
    // A retry continues a copy whose previous attempt failed; anything else starting mid-chain falls back to the previous attempt.
    let copy = -1;
    if (t.attempt > 1) {
      copy = copies.findIndex((c) => c.lastAttempt === t.attempt - 1 && c.lastFailed);
      if (copy === -1) copy = copies.findIndex((c) => c.lastAttempt === t.attempt - 1);
    }
    if (copy === -1) {
      copy = copies.length;
      copies.push({ lastAttempt: t.attempt, lastFailed: isFailedDelivery(t) });
    } else {
      copies[copy] = { lastAttempt: t.attempt, lastFailed: isFailedDelivery(t) };
    }
    const duplicate = copy > 0;

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
      copy,
      duplicate,
      forged: event.forged,
      failedChecks,
    });
  }
  return rows;
}

/** One notice as the developer thinks of it: all the attempts to deliver it, boiled down. */
export interface NoticeRow extends DeliveryRow {
  /** How many delivery attempts this notice took. */
  tries: number;
  /** The worst thing that happened: null if any attempt timed out, else the highest status code. */
  worstStatus: number | null;
  /** When the last attempt happened. `at` is when the first one did. */
  lastAt: string;
}

// Type-only imports from contracts keep its zod and yaml parser out of the browser bundle; the labels table is in check order.
const CHECK_ORDER = new Map((Object.keys(CHECK_TITLES) as CheckId[]).map((id, i) => [id, i]));

/**
 * One row per notice (an event, and each extra copy PayPal delivered of it). `status`, `ms` and `attempt`
 * are the last attempt's, because that is how the story ended; failing checks are the union over all attempts.
 */
export function toNoticeRows(rows: DeliveryRow[]): NoticeRow[] {
  const groups = new Map<string, DeliveryRow[]>();
  for (const r of rows) {
    const key = `${r.eventId}#c${r.copy}`;
    const group = groups.get(key);
    if (group) group.push(r);
    else groups.set(key, [r]);
  }
  return [...groups].map(([id, attempts]) => {
    const first = attempts[0]!;
    const last = attempts[attempts.length - 1]!;
    const timedOut = attempts.some((a) => a.status === null);
    const worstStatus = timedOut ? null : Math.max(...attempts.map((a) => a.status ?? 0));
    const failedChecks = [...new Set(attempts.flatMap((a) => a.failedChecks))].sort((a, b) => (CHECK_ORDER.get(a) ?? 0) - (CHECK_ORDER.get(b) ?? 0));
    return {
      ...last,
      id,
      at: first.at,
      lastAt: last.at,
      tries: attempts.length,
      worstStatus,
      verified: attempts.some((a) => a.verified),
      failedChecks,
    };
  });
}
