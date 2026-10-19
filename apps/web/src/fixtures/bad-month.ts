import type { Report, TraceEntry } from '@fastforward/contracts';
import recorded from './bad-month.recorded.json';

/**
 * A REAL run: examples/coffee-club/scenarios/bad-month.yaml against Coffee Club with its bugs switched on,
 * recorded by the CLI runner. Regenerate with `npm run fixture -w @fastforward/web` so this never drifts
 * from what the twin really does. Shown only when no twin is reachable.
 */
export interface RecordedRun {
  recordedAt: string;
  /** How it was recorded: which scenario, which Coffee Club bugs, whether AI was on. */
  recipe: { scenario: string; coffeeBugs: string; ai: string };
  runId: string;
  scenario: string;
  start: string;
  end: string;
  subscriptions: { customer: string; subscriptionId: string }[];
  trace: TraceEntry[];
  report: Report;
}

export const badMonth = recorded as unknown as RecordedRun;
