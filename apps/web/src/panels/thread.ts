import type { TraceEntry } from '@fastforward/contracts';
import { eventOwners, type TimelineRow } from '../timeline/model.js';

export interface ThreadMessage {
  at: string;
  from: 'buyer' | 'seller' | 'system';
  text: string;
  /** The model decided and wrote this customer message (live, or replayed from a recording). */
  byModel?: boolean;
}

export interface DisputeThread {
  disputeId: string;
  customer: string;
  messages: ThreadMessage[];
}

const SELLER_ACTION_TEXT: Record<string, string> = {
  'provide-evidence': 'Sent evidence of fulfilment.',
  'accept-claim': 'Accepted the claim.',
  'send-message': 'Sent a message.',
  'make-offer': 'Made an offer.',
};

const readable = (code: string): string => code.toLowerCase().replace(/_/g, ' ');
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Rebuilds each dispute as a conversation from the trace: opening, buyer words, seller actions, outcome. */
export function disputeThreads(trace: TraceEntry[], subscriptions: TimelineRow[]): DisputeThread[] {
  const nameOf = new Map(subscriptions.map((s) => [s.subscriptionId, s.customer]));
  const owners = eventOwners(trace);
  const threads = new Map<string, DisputeThread>();

  for (const t of trace) {
    if (t.kind !== 'event') continue;
    const r = t.event.resource;
    const disputeId = str(r.dispute_id);
    if (!disputeId || !t.event.event_type.startsWith('CUSTOMER.DISPUTE.')) continue;

    let thread = threads.get(disputeId);
    if (!thread) {
      const owner = owners.get(t.event.id);
      thread = { disputeId, customer: (owner && nameOf.get(owner)) || '—', messages: [] };
      threads.set(disputeId, thread);
    }

    if (t.event.event_type === 'CUSTOMER.DISPUTE.CREATED') {
      const reason = str(r.reason);
      const due = str(r.seller_response_due_date);
      const posted = Array.isArray(r.messages) ? (r.messages as { posted_by?: string; time_posted?: string; content?: string }[]) : [];
      // The opening line comes first even when the buyer's message is stamped a moment before the event.
      const openedAt = [t.at, ...posted.flatMap((m) => (m.time_posted ? [m.time_posted] : []))].sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
      thread.messages.push({
        at: openedAt,
        from: 'system',
        text: `Dispute opened${reason ? `: ${readable(reason)}` : ''}${due ? `. Seller must respond by ${due.slice(0, 10)}.` : '.'}`,
      });
      for (const m of posted) {
        if (m.content) thread.messages.push({ at: m.time_posted ?? t.at, from: m.posted_by === 'SELLER' ? 'seller' : 'buyer', text: m.content });
      }
    } else if (t.event.event_type === 'CUSTOMER.DISPUTE.RESOLVED') {
      const outcome = str((r.dispute_outcome as { outcome_code?: unknown } | undefined)?.outcome_code);
      const favour = outcome === 'RESOLVED_BUYER_FAVOUR' ? "Resolved in the buyer's favour." : outcome === 'RESOLVED_SELLER_FAVOUR' ? "Resolved in the seller's favour." : 'Resolved.';
      thread.messages.push({ at: t.at, from: 'system', text: favour });
    }
  }

  for (const t of trace) {
    if (t.kind === 'dispute_action') {
      threads.get(t.disputeId)?.messages.push({ at: t.at, from: 'seller', text: SELLER_ACTION_TEXT[t.action] ?? t.action });
    } else if (t.kind === 'customer_decision' && (t.decision.action === 'reply' || t.decision.action === 'dispute')) {
      const thread = [...threads.values()].find((th) => th.customer === t.customer);
      thread?.messages.push({ at: t.at, from: 'buyer', text: t.decision.message, ...(t.by === 'model' ? { byModel: true } : {}) });
    }
  }

  for (const th of threads.values()) th.messages.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return [...threads.values()];
}
