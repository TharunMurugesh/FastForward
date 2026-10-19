import type { CheckResult, Finding } from '@fastforward/contracts';
import { day, type CheckContext } from './context.js';

const times = (n: number) => (n === 1 ? 'once' : n === 0 ? 'never' : `${n} times`);
const payments = (n: number) => (n === 1 ? '1 payment' : `${n} payments`);

/** FULFIL_ONCE: what the app delivered (fulfilments) equals the payments that actually completed. */
export function fulfilOnce(ctx: CheckContext): CheckResult {
  const reported = ctx.probes.filter((p) => p.fulfilments !== null);
  if (reported.length === 0) {
    return { id: 'FULFIL_ONCE', status: 'skipped', findings: [], note: 'your app does not report fulfilments from its probe endpoint' };
  }

  const findings: Finding[] = [];
  for (const p of reported) {
    if (p.fulfilments === p.completedPayments) continue;
    const who = ctx.customerOf(p.subscriptionId);
    const saleIds = ctx.events
      .filter((e) => !e.forged && e.event.event_type === 'PAYMENT.SALE.COMPLETED' && e.event.resource.billing_agreement_id === p.subscriptionId && Date.parse(e.at) <= Date.parse(p.at))
      .map((e) => e.event.id);
    findings.push({
      at: p.at,
      summary: `${who} was given what they paid for ${times(p.fulfilments!)} by ${day(p.at)}, but only ${payments(p.completedPayments)} had completed. ${
        p.fulfilments! > p.completedPayments ? 'Something was delivered without a matching payment, for example a repeated notice handled twice.' : 'A payment went unfulfilled.'
      }`,
      eventIds: saleIds,
    });
  }
  return { id: 'FULFIL_ONCE', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
