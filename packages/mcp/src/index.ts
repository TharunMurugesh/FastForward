import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AiUnavailableError, aiFromEnv, writeScenario, type AiClient } from '@fastforward/ai';
import { runScenarioFile, scenarioToYaml, ToolError, type RunOptions } from '@fastforward/cli';
import { CHECK_IDS, type CheckResult, type Finding, type Report } from '@fastforward/contracts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export interface ServerOptions {
  /** Relative paths and `.fastforward/runs` resolve here. Default: where the assistant started the server. */
  cwd?: string;
  /** undefined: from the environment (FF_AI, ANTHROPIC_API_KEY). null: no AI. */
  ai?: AiClient | null;
  /** Passed to the runner as is, except `reportDir` and `ai`, which this server owns. */
  runOptions?: Omit<RunOptions, 'reportDir' | 'ai'>;
}

/** A runId becomes a folder name, so only the shape the twin hands out is accepted. */
const RUN_ID = /^run-[0-9a-f]+$/;

const text = (body: string) => ({ content: [{ type: 'text' as const, text: body }] });
const failure = (message: string) => ({ isError: true as const, content: [{ type: 'text' as const, text: message }] });

/** Turns a thrown error into a tool result the assistant can read, so a bad call never kills the server. */
async function guarded(job: () => Promise<ReturnType<typeof text>>) {
  try {
    return await job();
  } catch (err) {
    if (err instanceof ToolError || err instanceof AiUnavailableError) return failure(err.message);
    return failure(`unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function findingLines(f: Finding, indent: string): string[] {
  const lines = [`${indent}${f.summary}`];
  if (f.explanation) lines.push(`${indent}  ${f.explanation}`);
  if (f.fix) lines.push(`${indent}  Fix: ${f.fix}`);
  return lines;
}

/** Only the first finding per check goes in the run summary; `ff_explain` has the rest. */
function summarise(report: Report, reportDir: string): string {
  const out = [`runId: ${report.runId}`, `${report.scenario}: ${report.start.slice(0, 10)} to ${report.end.slice(0, 10)} (all simulated)`, ''];
  for (const c of report.checks) {
    out.push(`${c.id.padEnd(20)} ${c.status}${c.status === 'skipped' && c.note ? ` (${c.note})` : ''}`);
    const first = c.findings[0];
    if (c.status === 'fail' && first) {
      out.push(...findingLines(first, '  '));
      if (c.findings.length > 1) out.push(`  … ${c.findings.length - 1} more: call ff_explain with runId ${report.runId} and checkId ${c.id}`);
    }
  }
  const failed = report.checks.filter((c) => c.status === 'fail').length;
  out.push('', failed > 0 ? `${failed} of ${report.checks.length} checks failed.` : 'No checks failed.', `Report: ${reportDir}/report.json`);
  return out.join('\n');
}

export function createServer(opts: ServerOptions = {}): McpServer {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const runsRoot = join(cwd, '.fastforward', 'runs');
  const ai = () => (opts.ai === undefined ? aiFromEnv() : opts.ai);

  const server = new McpServer({ name: 'fastforward-mcp', version: '0.1.0' });

  server.registerTool(
    'ff_write_scenario',
    {
      description:
        'Write a Fastforward scenario (a YAML file describing customers, a plan and a time span) from a plain-English description. Returns the path of the new file. Needs an Anthropic API key in the environment.',
      inputSchema: {
        description: z.string().min(1).describe('What to simulate, e.g. "a coffee club with two customers, one whose card fails in month two"'),
        outputPath: z.string().optional().describe('Where to write the YAML. Default: <scenario name>.yaml in the working folder. Never overwrites.'),
      },
    },
    ({ description, outputPath }) =>
      guarded(async () => {
        const scenario = await writeScenario(description, ai());
        const out = resolve(cwd, outputPath ?? `${scenario.name}.yaml`);
        if (existsSync(out)) throw new ToolError(`${out} already exists; choose another outputPath`);
        writeFileSync(out, scenarioToYaml(scenario));
        return text(`Wrote ${out}. Check it, then call ff_run with scenarioPath ${out}.`);
      }),
  );

  server.registerTool(
    'ff_run',
    {
      description:
        "Play a scenario against the developer's PayPal-integrated app (already running with FASTFORWARD=1 node --import @fastforward/register) on a simulated PayPal and report billing bugs. Returns each check's status, the first finding with its explanation and fix, and a runId for ff_explain. Everything is simulated; no real PayPal call is made.",
      inputSchema: { scenarioPath: z.string().min(1).describe('Path to the scenario YAML') },
    },
    ({ scenarioPath }) =>
      guarded(async () => {
        // The runner names the folder after the run id, which it only knows once it has started.
        mkdirSync(runsRoot, { recursive: true });
        const pending = join(runsRoot, `.pending-${process.pid}-${Date.now()}`);
        try {
          const result = await runScenarioFile(resolve(cwd, scenarioPath), { ...opts.runOptions, reportDir: pending, ai: ai() });
          const finalDir = join(runsRoot, result.runId);
          rmSync(finalDir, { recursive: true, force: true });
          renameSync(pending, finalDir);
          return text(summarise(result.report, finalDir));
        } finally {
          rmSync(pending, { recursive: true, force: true });
        }
      }),
  );

  server.registerTool(
    'ff_explain',
    {
      description: 'List every finding of one check from an earlier ff_run, with explanation and fix. Use it when the run summary says there are more findings.',
      inputSchema: {
        runId: z.string().describe('The runId from ff_run, e.g. run-1a2b3c4d'),
        checkId: z.enum(CHECK_IDS).describe('The check to expand, e.g. FULFIL_ONCE'),
      },
    },
    ({ runId, checkId }) =>
      guarded(async () => {
        if (!RUN_ID.test(runId)) throw new ToolError(`runId looks like "run-1a2b3c4d"; got "${runId}"`);
        const file = join(runsRoot, runId, 'report.json');
        if (!existsSync(file)) throw new ToolError(`no run ${runId} under ${runsRoot}. Call ff_run first and use the runId it returns.`);
        const report = JSON.parse(readFileSync(file, 'utf8')) as Report;
        const check: CheckResult | undefined = report.checks.find((c) => c.id === checkId);
        if (!check) throw new ToolError(`run ${runId} has no ${checkId} check`);
        const out = [`${check.id}: ${check.status}${check.note ? ` (${check.note})` : ''}`];
        if (check.findings.length === 0) out.push('No findings.');
        check.findings.forEach((f, i) => out.push(`${i + 1}. [${f.at}]`, ...findingLines(f, '   ')));
        return text(out.join('\n'));
      }),
  );

  return server;
}
