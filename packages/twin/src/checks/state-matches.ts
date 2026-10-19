import type { CheckResult, Finding } from '@fastforward/contracts';
import { day, type CheckContext } from './context.js';

const WHY: Record<string, string> = {
  SUSPENDED: 'PayPal had suspended the subscription',
  CANCELLED: 'the subscription was cancelled',
  EXPIRED: 'the subscription had ended',
  APPROVAL_PENDING: 'the subscription had not been approved yet',
  APPROVED: 'the subscription had not started billing yet',
  ACTIVE: 'the subscription was active',
};

/** STATE_MATCHES: at each checkpoint the app's access flag equals what the subscription's true status allows. */
export function stateMatches(ctx: CheckContext): CheckResult {
  if (!ctx.scenario.app.probeUrl) {
    return { id: 'STATE_MATCHES', status: 'skipped', findings: [], note: 'the scenario has no app.probeUrl, so the app\'s state could not be read' };
  }
  if (ctx.probes.length === 0) {
    return { id: 'STATE_MATCHES', status: 'skipped', findings: [], note: 'no checkpoint probed your app' };
  }

  const findings: Finding[] = [];
  for (const p of ctx.probes) {
    if (p.access === p.expectedAccess && p.access !== null) continue;
    const who = ctx.customerOf(p.subscriptionId);
    const state = ctx.statusAt(p.subscriptionId, p.at);
    const why = state ? (WHY[state.status] ?? `the subscription was ${state.status}`) : p.expectedAccess ? 'the subscription was in good standing' : 'the subscription did not allow access';
    const eventIds = state ? [state.eventId] : [];
    let summary: string;
    if (p.access === null) {
      summary = `On ${day(p.at)} your app did not answer the check of ${who}'s access, so it could not be compared with the subscription (${why}).`;
    } else if (p.access) {
      summary = `${who} still had access on ${day(p.at)} although ${why}.`;
    } else {
      summary = `${who} had no access on ${day(p.at)} although ${why} and access should have been allowed.`;
    }
    findings.push({ at: p.at, summary, eventIds });
  }
  return { id: 'STATE_MATCHES', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
