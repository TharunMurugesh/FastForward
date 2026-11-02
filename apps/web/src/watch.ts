import type { TraceEntry } from '@fastforward/contracts';
import { EVENT_LABELS } from './format.js';
import { CHOICE } from './realRun.js';

export interface FeedItem {
  key: string;
  at: string;
  title: string;
  /** Who it happened to, or who decided it. */
  detail: string;
  kind: 'notice' | 'decision';
  /** The notice is evidence for a failed check. */
  failed: boolean;
}

interface FeedNotice {
  eventId: string;
  at: string;
  customer: string;
  eventType: string;
  failedChecks: unknown[];
}

/** What has happened so far in the simulated months, newest first: the notices PayPal would send, and what each customer chose. */
export function watchFeed(notices: FeedNotice[], trace: TraceEntry[]): FeedItem[] {
  // A notice delivered twice has one event id and two rows, so the id alone is not a unique key.
  const items: FeedItem[] = notices.map((n, i) => ({
    key: `${n.eventId}-${i}`,
    at: n.at,
    title: EVENT_LABELS[n.eventType] ?? n.eventType,
    detail: n.customer,
    kind: 'notice',
    failed: n.failedChecks.length > 0,
  }));
  trace.forEach((t, i) => {
    if (t.kind !== 'customer_decision') return;
    items.push({
      key: `decision-${i}`,
      at: t.at,
      title: `${t.customer} chose to ${CHOICE[t.decision.action]}`,
      detail: t.by === 'model' ? 'Decided by Claude' : 'Scripted default',
      kind: 'decision',
      failed: false,
    });
  });
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
