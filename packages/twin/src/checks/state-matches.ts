import type { CheckResult, Finding } from '@fastforward/contracts';
import { checksNote, span, stretches, type CheckContext } from './context.js';

const WHY: Record<string, string> = {
  SUSPENDED: 'PayPal had suspended the subscription',
  CANCELLED: 'the subscription was cancelled',
  EXPIRED: 'the subscription had ended',
  APPROVAL_PENDING: 'the subscription had not been approved yet',
  APPROVED: 'the subscription had not started billing yet',
  ACTIVE: 'the subscription was active',
};

/**
 * STATE_MATCHES: at each checkpoint the app's access flag equals what the subscription's true status allows.
 * Consecutive bad checkpoints for one subscription with the same wrong answer are reported as one stretch.
 */
export function stateMatches(ctx: CheckContext): CheckResult {
  if (!ctx.scenario.app.probeUrl) {
    return { id: 'STATE_MATCHES', status: 'skipped', findings: [], note: 'the scenario has no app.probeUrl, so the app\'s state could not be read' };
  }
  if (ctx.probes.length === 0) {
    return { id: 'STATE_MATCHES', status: 'skipped', findings: [], note: 'no checkpoint probed your app' };
  }

  const bad = stretches(ctx.probes, (p) => (p.access === p.expectedAccess && p.access !== null ? null : `${p.access}|${p.expectedAccess}`));
  const findings: Finding[] = bad.map(({ first: p, last, count }): Finding => {
    const who = ctx.customerOf(p.subscriptionId);
    // The notices only name the true status if they agree with the verdict the probe was judged by. If they
    // do not (the notice that changed the status never reached the trace), say nothing about the status
    // rather than something that contradicts the finding.
    const known = ctx.statusAt(p.subscriptionId, p.at);
    const state = known && ctx.scenario.expect.accessWhile.includes(known.status as never) === p.expectedAccess ? known : null;
    const why = state ? (WHY[state.status] ?? `the subscription was ${state.status}`) : p.expectedAccess ? 'the subscription was in good standing' : 'the subscription did not allow access';
    const n = checksNote(count);
    let summary: string;
    if (p.access === null) {
      const when = span(p.at, last.at, 'On');
      summary = `${when[0]!.toUpperCase()}${when.slice(1)} your app did not answer the check of ${who}'s access, so it could not be compared with the subscription (${why})${n}.`;
    } else if (p.access) {
      summary = `${who} still had access ${span(p.at, last.at)} although ${why}${n}.`;
    } else {
      summary = `${who} had no access ${span(p.at, last.at)} although ${why} and access should have been allowed${n}.`;
    }
    return { at: p.at, summary, eventIds: state ? [state.eventId] : [] };
  });
  return { id: 'STATE_MATCHES', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
