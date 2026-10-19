import type { CheckResult, Finding } from '@fastforward/contracts';
import { checksNote, span, stretches, type CheckContext } from './context.js';

const times = (n: number) => (n === 1 ? 'once' : n === 0 ? 'never' : `${n} times`);
const payments = (n: number) => (n === 1 ? '1 payment' : `${n} payments`);

/**
 * FULFIL_ONCE: what the app delivered (fulfilments) equals the payments that actually completed.
 * Consecutive bad checkpoints for one subscription with the same wrong figures are reported as one stretch.
 */
export function fulfilOnce(ctx: CheckContext): CheckResult {
  const reported = ctx.probes.filter((p) => p.fulfilments !== null);
  if (reported.length === 0) {
    return { id: 'FULFIL_ONCE', status: 'skipped', findings: [], note: 'your app does not report fulfilments from its probe endpoint' };
  }

  const bad = stretches(reported, (p) => (p.fulfilments === p.completedPayments ? null : `${p.fulfilments}|${p.completedPayments}`));
  const findings: Finding[] = bad.map(({ first: p, last, count }): Finding => {
    const who = ctx.customerOf(p.subscriptionId);
    const given = p.fulfilments!;
    const lastAt = Date.parse(last.at);
    const saleIds = (ctx.salesBySubscription.get(p.subscriptionId) ?? []).filter((e) => Date.parse(e.at) <= lastAt).map((e) => e.event.id);
    const hint = given > p.completedPayments ? 'Something was delivered without a matching payment, for example a repeated notice handled twice.' : 'A payment went unfulfilled.';
    return {
      at: p.at,
      summary: `${who} was given what they paid for ${times(given)} ${span(p.at, last.at, 'by')}, but only ${payments(p.completedPayments)} had completed${checksNote(count)}. ${hint}`,
      eventIds: saleIds,
    };
  });
  return { id: 'FULFIL_ONCE', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
