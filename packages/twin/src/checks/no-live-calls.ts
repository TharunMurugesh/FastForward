import type { CheckResult } from '@fastforward/contracts';
import { day, type CheckContext } from './context.js';

/** NO_LIVE_CALLS: the app never tried to reach live PayPal (the register add-on blocked and reported each try). */
export function noLiveCalls(ctx: CheckContext): CheckResult {
  const findings = ctx.liveCalls.map((c) => ({
    at: c.at,
    summary: `On ${day(c.at)} your app tried to call live PayPal (${c.url}). The call was blocked; a test run must only talk to the sandbox.`,
    eventIds: [],
  }));
  return { id: 'NO_LIVE_CALLS', status: findings.length > 0 ? 'fail' : 'pass', findings };
}
