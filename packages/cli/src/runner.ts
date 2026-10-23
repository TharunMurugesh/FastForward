import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { DecisionLock, MODEL, NarrationLock, aiFromEnv, decideWithSource, explain, type AiClient } from '@fastforward/ai';
import { parseScenario, type AiSummary, type CheckId, type ExplanationSource, type Report, type Scenario, type TraceEntry } from '@fastforward/contracts';
import { buildReport, createTwin, type Twin } from '@fastforward/twin';
import { ToolError } from './errors.js';
import { renderHtmlReport } from './html-report.js';
import { checkReachable } from './reachability.js';

export interface RunOptions {
  /** Where report.json goes. Default `.fastforward/runs/<runId>/`. */
  reportDir?: string;
  /** Delete the saved decisions and explanations first, so the model decides and writes afresh. */
  fresh?: boolean;
  /** Use a twin that is already running (`fastforward twin`) instead of starting one inside this process. */
  twinUrl?: string;
  /** Port for the in-process twin. Default 4010, where the register add-on looks; 0 picks a free one. */
  twinPort?: number;
  /** undefined: from the environment (FF_AI, ANTHROPIC_API_KEY). null: no AI, scripted customers and template text. */
  ai?: AiClient | null;
  /** Where the dashboard is served. Default `$FF_DASHBOARD_URL` or http://localhost:5173. */
  dashboardUrl?: string;
  /** Leave the in-process twin running after the run so the dashboard can read it. The caller closes it. */
  keepTwin?: boolean;
}

export interface RunResult {
  report: Report;
  /** The full trace the report was computed from. */
  trace: TraceEntry[];
  reportDir: string;
  /** The report as one self-contained HTML file, next to report.json. */
  htmlReportPath: string;
  /** 0 when every check passed or was skipped, 1 when any failed. Tool errors are thrown as ToolError. */
  exitCode: 0 | 1;
  runId: string;
  dashboardLink: string;
  /** Only when `keepTwin` was set; otherwise the twin is already closed. */
  twin: Twin | null;
}

/** Only the first few findings per check get an AI explanation: one bad habit repeats on every delivery. */
const NARRATED_PER_CHECK = 3;
const REACHABLE_TIMEOUT_MS = 5000;

interface Reply {
  status: number;
  body: any;
}
type Call = (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<Reply>;

/** In-process twin: call it directly, so a long run never meets an HTTP header timeout. */
const direct =
  (twin: Twin): Call =>
  async (method, path, body) => {
    const res = await twin.app.inject({ method, url: path, ...(body === undefined ? {} : { payload: body as object }) });
    return { status: res.statusCode, body: res.body ? res.json() : null };
  };

const overHttp =
  (base: string): Call =>
  async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

export const lockPathFor = (scenarioPath: string): string => join(dirname(scenarioPath), `${basename(scenarioPath, extname(scenarioPath))}.lock.json`);
/** The failure explanations the model wrote, saved next to the scenario like the customer decisions. */
export const narrationLockPathFor = (scenarioPath: string): string => join(dirname(scenarioPath), `${basename(scenarioPath, extname(scenarioPath))}.narration.lock.json`);

export async function runScenarioFile(path: string, opts: RunOptions = {}): Promise<RunResult> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ToolError(`can't read ${path}: ${(err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file. Check the path, or create a starter with: fastforward init' : (err as Error).message}`);
  }
  let scenario: Scenario;
  try {
    scenario = parseScenario(text);
  } catch (err) {
    throw new ToolError(`${path}: ${(err as Error).message}`);
  }

  await checkReachable(scenario.app.webhookUrl, REACHABLE_TIMEOUT_MS);

  const ai = opts.ai === undefined ? aiFromEnv() : opts.ai;
  const lockPath = lockPathFor(path);
  const narrationPath = narrationLockPathFor(path);
  if (opts.fresh) {
    rmSync(lockPath, { force: true });
    rmSync(narrationPath, { force: true });
  }
  const lock = DecisionLock.load(lockPath);
  const narrationLock = NarrationLock.load(narrationPath);

  let twin: Twin | null = null;
  let call: Call;
  if (opts.twinUrl) {
    call = overHttp(opts.twinUrl);
  } else {
    try {
      twin = await createTwin({ port: opts.twinPort ?? 4010, deps: { decide: (ctx) => decideWithSource(ctx, ai, lock) } });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        throw new ToolError(`port ${opts.twinPort ?? 4010} is already in use. Is a twin already running? Use --twin-url, or pick another port with --twin-port.`);
      }
      throw err;
    }
    call = direct(twin);
  }

  try {
    const created = await call('POST', '/_ff/runs', { scenario });
    if (created.status !== 201) throw new ToolError(created.body?.error ?? `the twin refused the run (${created.status})`);
    const runId = created.body.runId as string;

    const finished = await call('POST', `/_ff/runs/${runId}/finish`);
    if (finished.status !== 200) throw new ToolError(finished.body?.error ?? `the twin could not finish the run (${finished.status})`);
    const traceReply = await call('GET', `/_ff/runs/${runId}/trace`);
    const trace = traceReply.body as TraceEntry[];

    const report = buildReport({ runId, scenario, start: scenario.start, end: finished.body.end as string, trace });
    const items = await explainFailures(report, trace, ai, narrationLock);
    const summary = aiSummary({ ai, trace, items });
    if (summary) report.ai = summary;
    // The dashboard reads its report from the twin, which does not know the explanations until they are handed over.
    await call('PUT', `/_ff/runs/${runId}/explanations`, { items, ...(summary ? { ai: summary } : {}) }).catch(() => undefined);

    if (lock.size > 0) lock.save();
    if (narrationLock.size > 0) narrationLock.save();

    const reportDir = opts.reportDir ?? join('.fastforward', 'runs', runId);
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    const htmlReportPath = join(reportDir, 'report.html');
    writeFileSync(htmlReportPath, renderHtmlReport(report, { scenario, trace }));

    const base = opts.dashboardUrl ?? process.env.FF_DASHBOARD_URL ?? 'http://localhost:5173';
    const dashboardLink = `${base.replace(/\/$/, '')}/?run=${runId}`;
    const keep = opts.keepTwin === true && twin !== null;
    return {
      report,
      trace,
      reportDir,
      htmlReportPath,
      exitCode: report.checks.some((c) => c.status === 'fail') ? 1 : 0,
      runId,
      dashboardLink,
      twin: keep ? twin : null,
    };
  } catch (err) {
    await twin?.close();
    twin = null;
    throw err;
  } finally {
    if (twin && !opts.keepTwin) await twin.close();
  }
}

interface ExplanationItem {
  check: CheckId;
  index: number;
  explanation: string;
  fix: string;
  source: ExplanationSource;
}

/** Explains the first few findings of each failing check, from a saved recording, the model or a template, and says which. */
async function explainFailures(report: Report, trace: TraceEntry[], ai: AiClient | null, lock: NarrationLock): Promise<ExplanationItem[]> {
  const jobs: Promise<ExplanationItem>[] = [];
  for (const check of report.checks) {
    if (check.status !== 'fail') continue;
    check.findings.slice(0, NARRATED_PER_CHECK).forEach((finding, index) => {
      jobs.push(
        explain(check.id, finding, trace, ai, lock).then(({ explanation, fix, source }) => {
          finding.explanation = explanation;
          finding.fix = fix;
          finding.explanationSource = source;
          return { check: check.id, index, explanation, fix, source };
        }),
      );
    });
  }
  return Promise.all(jobs);
}

/** How much of the run the model did, live or replayed. Undefined when it did none of it (the report then says nothing about AI). */
function aiSummary(opts: { ai: AiClient | null; trace: TraceEntry[]; items: ExplanationItem[] }): AiSummary | undefined {
  // Counted from the trace, where the twin wrote who decided, so it is right whether the twin runs here or elsewhere.
  const decisions = opts.trace.flatMap((t) => (t.kind === 'customer_decision' ? [t] : []));
  const totalDecisions = decisions.length;
  const modelDecisions = decisions.filter((t) => t.by === 'model').length;
  const modelExplanations = opts.items.filter((i) => i.source === 'model').length;
  const usage = opts.ai?.usage?.();
  if (modelDecisions === 0 && modelExplanations === 0 && (usage?.calls ?? 0) === 0) return undefined;
  return {
    model: MODEL,
    customerDecisions: { model: modelDecisions, total: totalDecisions },
    explanations: { model: modelExplanations, total: opts.items.length },
    ...(usage ? { calls: usage.calls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } : {}),
  };
}
