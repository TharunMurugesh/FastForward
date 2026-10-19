import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { DecisionLock, aiFromEnv, decideCustomerAction, narrate, type AiClient } from '@fastforward/ai';
import { parseScenario, type Report, type Scenario, type TraceEntry } from '@fastforward/contracts';
import { buildReport, createTwin, type Twin } from '@fastforward/twin';
import { ToolError } from './errors.js';
import { checkReachable } from './reachability.js';

export interface RunOptions {
  /** Where report.json goes. Default `.fastforward/runs/<runId>/`. */
  reportDir?: string;
  /** Delete the decision lock first, so AI customers decide afresh. */
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
type Call = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<Reply>;

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

export async function runScenarioFile(path: string, opts: RunOptions = {}): Promise<RunResult> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new ToolError(`can't read ${path}: ${(err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (err as Error).message}`);
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
  if (opts.fresh) rmSync(lockPath, { force: true });
  const lock = DecisionLock.load(lockPath);

  let twin: Twin | null = null;
  let call: Call;
  if (opts.twinUrl) {
    call = overHttp(opts.twinUrl);
  } else {
    try {
      twin = await createTwin({ port: opts.twinPort ?? 4010, deps: { decide: (ctx) => decideCustomerAction(ctx, ai, lock) } });
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
    await explainFailures(report, trace, ai);

    if (lock.size > 0) lock.save();

    const reportDir = opts.reportDir ?? join('.fastforward', 'runs', runId);
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');

    const base = opts.dashboardUrl ?? process.env.FF_DASHBOARD_URL ?? 'http://localhost:5173';
    const dashboardLink = `${base.replace(/\/$/, '')}/?run=${runId}`;
    const keep = opts.keepTwin === true && twin !== null;
    return {
      report,
      trace,
      reportDir,
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

async function explainFailures(report: Report, trace: TraceEntry[], ai: AiClient | null): Promise<void> {
  const jobs: Promise<void>[] = [];
  for (const check of report.checks) {
    if (check.status !== 'fail') continue;
    for (const finding of check.findings.slice(0, NARRATED_PER_CHECK)) {
      jobs.push(
        narrate(check.id, finding, trace, ai).then(({ explanation, fix }) => {
          finding.explanation = explanation;
          finding.fix = fix;
        }),
      );
    }
  }
  await Promise.all(jobs);
}
