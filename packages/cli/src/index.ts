import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AiUnavailableError, DecisionLock, aiFromEnv, decideCustomerAction, writeScenario, type AiClient } from '@fastforward/ai';
import { createTwin } from '@fastforward/twin';
import { ToolError } from './errors.js';
import { DEFAULT_WEBHOOK_URL, writeStarter } from './init.js';
import { formatReport } from './print.js';
import { runScenarioFile } from './runner.js';
import { scenarioToYaml } from './yaml.js';

export { ToolError } from './errors.js';
export { checkReachable } from './reachability.js';
export { formatReport } from './print.js';
export { renderHtmlReport, type HtmlReportOptions } from './html-report.js';
export { runScenarioFile, lockPathFor, type RunOptions, type RunResult } from './runner.js';
export { scenarioToYaml } from './yaml.js';

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** undefined: from the environment. null: no AI. */
  ai?: AiClient | null;
  /** Resolves when the user presses Ctrl+C. Injected so tests never wait on a signal. */
  waitForInterrupt?: () => Promise<void>;
}

const defaultIo: CliIo = {
  stdout: (t) => void process.stdout.write(t),
  stderr: (t) => void process.stderr.write(t),
};

const USAGE = `Usage:
  fastforward run <scenario.yaml> [--report-dir <dir>] [--fresh] [--keep-twin]
                                  [--twin-url <url>] [--twin-port <n>] [--dashboard-url <url>]
  fastforward init [-o <file.yaml>] [--webhook-url <url>]
  fastforward new "<description>" [-o <file.yaml>]
  fastforward twin [--port <n>]

run    plays the scenario against your app (started with FASTFORWARD=1 node --import fastforward-register)
       and reports billing bugs. Exit code 0 = all checks passed or skipped, 1 = a check failed, 2 = could not run.
init   writes a starter scenario (fastforward.yaml) and prints the next steps. No AI, no key.
new    asks Claude to write a scenario from a description (needs ANTHROPIC_API_KEY).
twin   starts the stand-in PayPal on its own, default port 4010.
`;

const waitForSigint = (): Promise<void> => new Promise((resolve) => process.once('SIGINT', () => resolve()));

/** Runs one command and returns the exit code: 0 ok, 1 a check failed, 2 the tool could not do its job. */
export async function main(argv: string[], io: CliIo = defaultIo): Promise<0 | 1 | 2> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'run':
        return await runCommand(rest, io);
      case 'init':
        return await initCommand(rest, io);
      case 'new':
        return await newCommand(rest, io);
      case 'twin':
        return await twinCommand(rest, io);
      default:
        io.stderr(command ? `unknown command "${command}"\n\n${USAGE}` : USAGE);
        return 2;
    }
  } catch (err) {
    if (err instanceof ToolError || err instanceof AiUnavailableError) io.stderr(`error: ${err.message}\n`);
    else io.stderr(`unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return 2;
  }
}

function parse<T extends Record<string, { type: 'string' | 'boolean'; short?: string }>>(args: string[], options: T) {
  try {
    return parseArgs({ args, options, allowPositionals: true });
  } catch (err) {
    throw new ToolError(`${(err as Error).message}\n\n${USAGE}`);
  }
}

async function runCommand(args: string[], io: CliIo): Promise<0 | 1 | 2> {
  const { values, positionals } = parse(args, {
    'report-dir': { type: 'string' },
    fresh: { type: 'boolean' },
    'keep-twin': { type: 'boolean' },
    'twin-url': { type: 'string' },
    'twin-port': { type: 'string' },
    'dashboard-url': { type: 'string' },
  });
  const file = positionals[0];
  if (!file) throw new ToolError(`run needs a scenario file\n\n${USAGE}`);
  const twinPort = values['twin-port'] === undefined ? undefined : Number(values['twin-port']);
  if (twinPort !== undefined && !Number.isInteger(twinPort)) throw new ToolError('--twin-port must be a whole number');

  const result = await runScenarioFile(file, {
    ...(values['report-dir'] ? { reportDir: values['report-dir'] } : {}),
    ...(values.fresh ? { fresh: true } : {}),
    ...(values['twin-url'] ? { twinUrl: values['twin-url'] } : {}),
    ...(twinPort !== undefined ? { twinPort } : {}),
    ...(values['dashboard-url'] ? { dashboardUrl: values['dashboard-url'] } : {}),
    ...(io.ai !== undefined ? { ai: io.ai } : {}),
    keepTwin: values['keep-twin'] === true,
  });

  io.stdout(formatReport(result.report, { reportDir: result.reportDir, htmlReport: result.htmlReportPath, dashboardLink: result.dashboardLink, twinKept: result.twin !== null || values['twin-url'] !== undefined }));
  if (result.twin) {
    io.stdout(`\nThe twin is still running at ${result.twin.url}. Press Ctrl+C to stop it.\n`);
    await (io.waitForInterrupt ?? waitForSigint)();
    await result.twin.close();
  }
  return result.exitCode;
}

async function initCommand(args: string[], io: CliIo): Promise<0 | 1 | 2> {
  const { values } = parse(args, { output: { type: 'string', short: 'o' }, 'webhook-url': { type: 'string' } });
  io.stdout(writeStarter({ output: values.output ?? 'fastforward.yaml', webhookUrl: values['webhook-url'] ?? DEFAULT_WEBHOOK_URL }));
  return 0;
}

async function newCommand(args: string[], io: CliIo): Promise<0 | 1 | 2> {
  const { values, positionals } = parse(args, { output: { type: 'string', short: 'o' } });
  const description = positionals.join(' ').trim();
  if (!description) throw new ToolError(`new needs a description, for example: fastforward new "a coffee club with two customers, one whose card fails"\n\n${USAGE}`);

  const ai = io.ai === undefined ? aiFromEnv() : io.ai;
  const scenario = await writeScenario(description, ai);
  const out = values.output ?? `${scenario.name}.yaml`;
  if (existsSync(out)) throw new ToolError(`${out} already exists; choose another file with -o`);
  writeFileSync(out, scenarioToYaml(scenario));
  io.stdout(`Wrote ${out}. Check it, then run: fastforward run ${out}\n`);
  return 0;
}

async function twinCommand(args: string[], io: CliIo): Promise<0 | 1 | 2> {
  const { values } = parse(args, { port: { type: 'string' } });
  const port = values.port === undefined ? 4010 : Number(values.port);
  if (!Number.isInteger(port)) throw new ToolError('--port must be a whole number');

  const ai = io.ai === undefined ? aiFromEnv() : io.ai;
  const lock = DecisionLock.load('.fastforward/twin.lock.json');
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  let twin;
  try {
    twin = await createTwin({
      port,
      ...(clientId && clientSecret ? { sandboxCreds: { clientId, clientSecret } } : {}),
      deps: { decide: (ctx) => decideCustomerAction(ctx, ai, lock) },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') throw new ToolError(`port ${port} is already in use. Is a twin already running?`);
    throw err;
  }
  io.stdout(`Fastforward twin listening at ${twin.url}\nPoint your app at it with FASTFORWARD=1 node --import fastforward-register, then run: fastforward run <scenario.yaml> --twin-url ${twin.url}\nPress Ctrl+C to stop.\n`);
  await (io.waitForInterrupt ?? waitForSigint)();
  if (lock.size > 0) lock.save();
  await twin.close();
  return 0;
}
