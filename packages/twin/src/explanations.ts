import { CHECK_IDS, type AiSummary, type CheckId, type ExplanationSource, type Report } from '@fastforward/contracts';

/**
 * What the command-line tool hands the twin after it has explained a run's failures, so the report the dashboard reads
 * (GET /_ff/runs/:id/report) carries the same explanations as the CLI's own report.json.
 */
export interface ExplanationItem {
  check: CheckId;
  /** Position of the finding within its check. */
  index: number;
  explanation: string;
  fix: string;
  source: ExplanationSource;
}

export interface ExplanationsPayload {
  items: ExplanationItem[];
  ai?: AiSummary;
}

const SOURCES: readonly string[] = ['model', 'template'];
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isPair = (v: unknown): v is { model: number; total: number } =>
  typeof v === 'object' && v !== null && isCount((v as Record<string, unknown>).model) && isCount((v as Record<string, unknown>).total);

/** The payload, or a one-line message saying what is wrong with the body. */
export function parseExplanations(body: unknown): ExplanationsPayload | string {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { items?: unknown }).items)) {
    return 'body must be {"items": [...], "ai"?: {...}}';
  }
  const items: ExplanationItem[] = [];
  for (const [n, raw] of (body as { items: unknown[] }).items.entries()) {
    const it = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    if (typeof it.check !== 'string' || !(CHECK_IDS as readonly string[]).includes(it.check)) return `items[${n}].check must be one of ${CHECK_IDS.join(', ')}`;
    if (!isCount(it.index)) return `items[${n}].index must be a whole number of at least 0`;
    if (typeof it.explanation !== 'string' || it.explanation === '') return `items[${n}].explanation must be a non-empty string`;
    if (typeof it.fix !== 'string' || it.fix === '') return `items[${n}].fix must be a non-empty string`;
    if (typeof it.source !== 'string' || !SOURCES.includes(it.source)) return `items[${n}].source must be "model" or "template"`;
    items.push({ check: it.check as CheckId, index: it.index, explanation: it.explanation, fix: it.fix, source: it.source as ExplanationSource });
  }

  const ai = (body as { ai?: unknown }).ai;
  if (ai === undefined) return { items };
  const a = (typeof ai === 'object' && ai !== null ? ai : {}) as Record<string, unknown>;
  if (typeof a.model !== 'string' || !isPair(a.customerDecisions) || !isPair(a.explanations)) {
    return 'ai must be {"model": string, "customerDecisions": {"model","total"}, "explanations": {"model","total"}}';
  }
  const summary: AiSummary = {
    model: a.model,
    customerDecisions: a.customerDecisions,
    explanations: a.explanations,
    ...(isCount(a.calls) ? { calls: a.calls } : {}),
    ...(isCount(a.inputTokens) ? { inputTokens: a.inputTokens } : {}),
    ...(isCount(a.outputTokens) ? { outputTokens: a.outputTokens } : {}),
  };
  return { items, ai: summary };
}

/** A copy of the report with the explanations on their findings. An item for a finding that does not exist is skipped. */
export function applyExplanations(report: Report, payload: ExplanationsPayload): Report {
  const out: Report = {
    ...report,
    checks: report.checks.map((c) => ({ ...c, findings: c.findings.map((f) => ({ ...f })) })),
    ...(payload.ai ? { ai: payload.ai } : {}),
  };
  for (const item of payload.items) {
    const finding = out.checks.find((c) => c.id === item.check)?.findings[item.index];
    if (!finding) continue;
    finding.explanation = item.explanation;
    finding.fix = item.fix;
    finding.explanationSource = item.source;
  }
  return out;
}
