export const CHECK_IDS = ['ACK_FAST', 'VERIFIES_SIGNATURES', 'STATE_MATCHES', 'FULFIL_ONCE', 'DISPUTE_ANSWERED', 'NO_LIVE_CALLS'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** Who wrote an explanation: the model (live, or replayed from a recording) or the built-in template for that check. */
export type ExplanationSource = 'model' | 'template';

export interface Finding {
  at: string;
  summary: string;
  eventIds: string[];
  explanation?: string;
  fix?: string;
  explanationSource?: ExplanationSource;
}

/** How much of a run was written by the model, so a reader can tell recorded model output from scripted text. */
export interface AiSummary {
  model: string;
  /** Customer decisions that came from the model (live or replayed) out of all decisions in the run. */
  customerDecisions: { model: number; total: number };
  /** Failure explanations written by the model out of all that were needed. */
  explanations: { model: number; total: number };
  /** Live model usage in this run. Absent or zero when everything was replayed from a recording. */
  calls?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface CheckResult {
  id: CheckId;
  status: 'pass' | 'fail' | 'skipped';
  findings: Finding[];
  note?: string;
}

export interface Report {
  runId: string;
  scenario: string;
  start: string;
  end: string;
  checks: CheckResult[];
  counts: { events: number; deliveries: number; customers: number };
  /** Present when the run used the model, live or from a recording. */
  ai?: AiSummary;
}

/** One sentence on how much of a run the model did, and whether it ran now or was replayed from a recording. */
export function describeAi(ai: AiSummary): string {
  const did = `${ai.customerDecisions.model} of ${ai.customerDecisions.total} customer decisions and ${ai.explanations.model} of ${ai.explanations.total} explanations`;
  const calls = ai.calls ?? 0;
  const tokens = ((ai.inputTokens ?? 0) + (ai.outputTokens ?? 0)).toLocaleString('en-US');
  const used = calls > 0 ? `${calls} model ${calls === 1 ? 'call' : 'calls'}, ${tokens} tokens` : 'no model calls now, replayed from a recording';
  return `${ai.model} wrote ${did} (${used})`;
}

/** Who wrote an explanation, in words for a reader; null when the report does not say. */
export function explanationLabel(source: ExplanationSource | undefined): string | null {
  if (source === 'model') return 'Written by Claude';
  if (source === 'template') return 'Built-in text';
  return null;
}
