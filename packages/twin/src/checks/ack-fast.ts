import type { CheckResult, Finding } from '@fastforward/contracts';
import { fidelity } from '../fidelity.js';
import { day, type CheckContext } from './context.js';

/**
 * ACK_FAST: every delivery attempt got a 2xx answer within the acknowledge window (fidelity.deliveryTimeoutMs).
 * A forged event is the exception: a correct app rejects it with an error status, so only silence or
 * slowness counts against the app there.
 */
export function ackFast(ctx: CheckContext): CheckResult {
  const findings: Finding[] = [];
  for (const d of ctx.deliveries) {
    const slow = d.ms > fidelity.deliveryTimeoutMs;
    const failed = d.status === null || (d.status >= 300 && !ctx.forgedIds.has(d.eventId));
    if (!failed && !slow) continue;
    const type = ctx.eventById.get(d.eventId)?.event_type ?? 'a';
    const tries = d.attempt > 1 ? ` (attempt ${d.attempt})` : '';
    const what =
      d.status === null
        ? `your app did not answer within ${seconds(fidelity.deliveryTimeoutMs)} seconds`
        : failed
          ? `your app answered with an error (HTTP ${d.status})`
          : `your app took ${seconds(d.ms)} seconds to answer, longer than the ${seconds(fidelity.deliveryTimeoutMs)} seconds PayPal waits`;
    findings.push({
      at: d.at,
      summary: `On ${day(d.at)} the ${type} notice ${d.eventId}${tries} was not acknowledged in time: ${what}. PayPal treats that as not delivered and sends it again.`,
      eventIds: [d.eventId],
    });
  }
  return { id: 'ACK_FAST', status: findings.length > 0 ? 'fail' : 'pass', findings };
}

const seconds = (ms: number) => (Math.round(ms / 100) / 10).toString();
