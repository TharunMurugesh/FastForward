import type { CheckResult, EventType, TraceEntry } from '@fastforward/contracts';
import type { NoticeRow } from './grids/rows.js';
import { eventOwners } from './timeline/model.js';

/** What a failed check comes to, in numbers a developer can act on. */
export interface ProblemFacts {
  /** Rows the deliveries table shows for this check (an extra copy of a notice is its own row). */
  notices: number;
  /** The customers it happened to, in the order they appear in the run. */
  customers: string[];
  /** The webhook handlers in the app to look at: each notice type involved and how many of its notices. */
  handlers: { eventType: EventType; count: number }[];
}

/**
 * Turns a check's findings into where to look: which handlers, how often, and for whom. Counted from the same
 * notice rows the table shows, so "See the 9 notices" opens 9 rows; a check about state over time, with no
 * notice rows, falls back to the events its findings name.
 */
export function problemFacts(
  check: CheckResult,
  notices: NoticeRow[],
  trace: TraceEntry[],
  subscriptions: { customer: string; subscriptionId: string }[],
): ProblemFacts {
  let items: { eventType: EventType; customer: string }[] = notices.filter((n) => n.failedChecks.includes(check.id)).map((n) => ({ eventType: n.eventType, customer: n.customer }));
  const rowCount = items.length;
  if (items.length === 0) {
    const typeOf = new Map<string, EventType>();
    for (const t of trace) if (t.kind === 'event') typeOf.set(t.event.id, t.event.event_type);
    const owners = eventOwners(trace);
    const nameOf = new Map(subscriptions.map((s) => [s.subscriptionId, s.customer]));
    items = [...new Set(check.findings.flatMap((f) => f.eventIds))]
      .filter((id) => typeOf.has(id))
      .map((id) => ({ eventType: typeOf.get(id)!, customer: nameOf.get(owners.get(id) ?? '') ?? '' }));
  }

  const counts = new Map<EventType, number>();
  for (const i of items) counts.set(i.eventType, (counts.get(i.eventType) ?? 0) + 1);
  const named = new Set(items.map((i) => i.customer));
  return {
    notices: rowCount,
    customers: subscriptions.map((s) => s.customer).filter((c) => named.has(c)),
    handlers: [...counts].map(([eventType, count]) => ({ eventType, count })).sort((a, b) => b.count - a.count),
  };
}

/** The first sentence of a long explanation, for a one-line preview; the whole text stays one click away. */
export function firstSentence(text: string): string {
  const m = /^.+?[.!?](?=\s|$)/s.exec(text.trim());
  return (m ? m[0] : text).trim();
}
