import type { CheckId, TraceEntry } from '@fastforward/contracts';
import { EVENT_LABELS } from './format.js';
import { CHOICE } from './realRun.js';

export interface FeedItem {
  key: string;
  at: string;
  title: string;
  /** Who it happened to, or who decided it. */
  detail: string;
  kind: 'notice' | 'decision';
  /** The PayPal event type, which picks the icon. Empty for a decision. */
  eventType: string;
  /** The checks this notice is evidence against. Empty when it did no harm. */
  problems: CheckId[];
}

interface FeedNotice {
  eventId: string;
  at: string;
  customer: string;
  eventType: string;
  failedChecks: CheckId[];
}

/**
 * What has happened so far in the simulated months, newest first: the notices PayPal would send, and what each
 * customer chose. `liveClaude` says the decisions were made in this run rather than replayed from a recording.
 */
export function watchFeed(notices: FeedNotice[], trace: TraceEntry[], liveClaude = false): FeedItem[] {
  // A notice delivered twice has one event id and two rows, so the id alone is not a unique key.
  const items: FeedItem[] = notices.map((n, i) => ({
    key: `${n.eventId}-${i}`,
    at: n.at,
    title: EVENT_LABELS[n.eventType] ?? n.eventType,
    detail: n.customer,
    kind: 'notice',
    eventType: n.eventType,
    problems: n.failedChecks,
  }));
  trace.forEach((t, i) => {
    if (t.kind !== 'customer_decision') return;
    items.push({
      key: `decision-${i}`,
      at: t.at,
      title: `${t.customer} chose to ${CHOICE[t.decision.action]}`,
      detail: t.by === 'model' ? (liveClaude ? 'Decided by Claude, just now' : 'Decided by Claude') : 'Scripted default',
      kind: 'decision',
      eventType: '',
      problems: [],
    });
  });
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
