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
 * What this cannot see: an app that fetches the certificate but never actually checks the signature.
 * Forged events catch that, because they change the app's state, which STATE_MATCHES reports.
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
    const attempts = ctx.deliveries.filter((d) => d.eventId === event.id);
    if (attempts.length === 0) continue;
    if (offline || attempts.some((d) => verified.has(d.transmissionId))) continue;
    findings.push({
      at,
      summary: `The ${event.event_type} notice ${event.id} was accepted without checking its signature (on ${day(attempts[0]!.at)}). Anyone who can reach your webhook URL could send a notice like it.`,
      eventIds: [event.id],
    });
  }
  return { id: 'VERIFIES_SIGNATURES', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
