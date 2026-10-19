import type { CheckResult, Finding } from '@fastforward/contracts';
import { day, type CheckContext } from './context.js';

/** DISPUTE_ANSWERED: every genuine dispute got a seller action no later than its seller_response_due_date. */
export function disputeAnswered(ctx: CheckContext): CheckResult {
  const disputes = ctx.events.filter((e) => !e.forged && e.event.event_type === 'CUSTOMER.DISPUTE.CREATED');
  if (disputes.length === 0) {
    return { id: 'DISPUTE_ANSWERED', status: 'skipped', findings: [], note: 'no customer opened a dispute' };
  }

  const actionsByDispute = new Map<string, number[]>();
  for (const a of ctx.disputeActions) {
    const times = actionsByDispute.get(a.disputeId);
    if (times) times.push(Date.parse(a.at));
    else actionsByDispute.set(a.disputeId, [Date.parse(a.at)]);
  }

  const findings: Finding[] = [];
  for (const { at, event } of disputes) {
    const disputeId = String(event.resource.dispute_id ?? event.resource.id ?? '');
    const dueRaw = event.resource.seller_response_due_date;
    const due = typeof dueRaw === 'string' ? Date.parse(dueRaw) : Number.POSITIVE_INFINITY;
    const answered = (actionsByDispute.get(disputeId) ?? []).some((t) => t <= due);
    if (answered) continue;
    findings.push({
      at,
      summary: `Dispute ${disputeId} opened on ${day(at)} was not answered${typeof dueRaw === 'string' ? ` by the deadline of ${day(dueRaw)}` : ''}. PayPal rules for the customer when the seller stays silent.`,
      eventIds: [event.id],
    });
  }
  return { id: 'DISPUTE_ANSWERED', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
