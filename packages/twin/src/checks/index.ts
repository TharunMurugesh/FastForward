import type { CheckResult, Report, Scenario, TraceEntry } from '@fastforward/contracts';
import { ackFast } from './ack-fast.js';
import { buildContext } from './context.js';
import { disputeAnswered } from './dispute-answered.js';
import { fulfilOnce } from './fulfil-once.js';
import { noLiveCalls } from './no-live-calls.js';
import { stateMatches } from './state-matches.js';
import { verifiesSignatures } from './verifies-signatures.js';

/** All six checks, in the order of `CheckId`. Pure: the verdicts depend only on the trace and scenario. */
export function runChecks(trace: TraceEntry[], scenario: Scenario): CheckResult[] {
  const ctx = buildContext(trace, scenario);
  return [ackFast(ctx), verifiesSignatures(ctx), stateMatches(ctx), fulfilOnce(ctx), disputeAnswered(ctx), noLiveCalls(ctx)];
}

export function buildReport(input: { runId: string; scenario: Scenario; start: string; end: string; trace: TraceEntry[] }): Report {
  const { runId, scenario, start, end, trace } = input;
  return {
    runId,
    scenario: scenario.name,
    start,
    end,
    checks: runChecks(trace, scenario),
    counts: {
      events: trace.filter((t) => t.kind === 'event').length,
      deliveries: trace.filter((t) => t.kind === 'delivery').length,
      customers: scenario.customers.length,
    },
  };
}
