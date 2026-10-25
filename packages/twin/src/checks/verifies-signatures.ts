import type { CheckResult, Finding } from '@fastforward/contracts';
import { day, type CheckContext } from './context.js';

/**
 * VERIFIES_SIGNATURES
 *
 * For every genuine (not forged) event that was delivered at least once, the app must have checked
 * the signature. It passes if either
 *   (a) some verify_call anywhere in the run carries a transmissionId equal to one of that event's
 *       delivery transmissionIds (the app asked PayPal, here the twin, to verify that very delivery), or
 *   (b) the run has at least one cert_fetch (the app downloaded the signing certificate, so it can
 *       verify offline; caching the certificate is legitimate).
 * Otherwise it fails with "notice <id> was accepted without checking its signature". It is skipped
 * when nothing was delivered.
 *
 * Asking is not enough: an app can ask PayPal "is this real?" and then ignore the answer. So a forged event
 * that the app answered with a success status (2xx) is a finding too ("accepted a forged notice"): the standard
 * advice is to reject a notice whose signature does not check out with an error status such as 400. Those
 * findings come after the genuine ones, so the first findings (the ones that get explained) never move.
 * A forged event the app never answered is not blamed on it (that is ACK_FAST's business).
 *
 * What this still cannot see: an app that rejects the forged notice but acts on a genuine one without
 * checking, in a way the deliveries do not show. STATE_MATCHES reports changes to the app's state.
 */
export function verifiesSignatures(ctx: CheckContext): CheckResult {
  if (ctx.deliveries.length === 0) {
    return { id: 'VERIFIES_SIGNATURES', status: 'skipped', findings: [], note: 'no notices were delivered to your app' };
  }
  const verified = new Set(ctx.verifyCalls.map((v) => v.transmissionId));
  const offline = ctx.certFetches.length > 0;

  const findings: Finding[] = [];
  for (const { at, event, forged } of ctx.events) {
    if (forged) continue;
    const attempts = ctx.deliveriesByEvent.get(event.id);
    if (!attempts) continue;
    if (offline || attempts.some((d) => verified.has(d.transmissionId))) continue;
    findings.push({
      at,
      summary: `The ${event.event_type} notice ${event.id} was accepted without checking its signature (on ${day(attempts[0]!.at)}). Anyone who can reach your webhook URL could send a notice like it.`,
      eventIds: [event.id],
    });
  }
  for (const { at, event, forged } of ctx.events) {
    if (!forged) continue;
    const accepted = ctx.deliveriesByEvent.get(event.id)?.find((d) => d.status !== null && d.status >= 200 && d.status < 300);
    if (!accepted) continue;
    findings.push({
      at,
      summary: `The forged ${event.event_type} notice ${event.id} (its signature does not check out) was answered with ${accepted.status}, which tells PayPal it was accepted (on ${day(accepted.at)}). Reject a notice whose signature fails with an error status such as 400.`,
      eventIds: [event.id],
    });
  }
  return { id: 'VERIFIES_SIGNATURES', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
