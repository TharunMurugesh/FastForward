// Regenerates apps/web/src/fixtures/bad-month.recorded.json from a REAL run, so the dashboard's sample
// view shows only what the twin really does and cannot drift from it.
//
//   npm run fixture -w @fastforward/web
//
// It builds the repo, starts the real Coffee Club (all bugs on, as a user would start their own app,
// with the register add-on), runs the unmodified examples/coffee-club/scenarios/bad-month.yaml with
// the real CLI runner and saves the trace, subscriptions and report. No AI, no live PayPal: the
// add-on sends the app's PayPal calls to the twin, and customers use their scripted defaults.
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scenarioFile = join(root, 'examples/coffee-club/scenarios/bad-month.yaml');
const outFile = fileURLToPath(new URL('../src/fixtures/bad-month.recorded.json', import.meta.url));

// bad-month.yaml fixes the app on 3000 and the register add-on's default twin is 4010.
const APP_PORT = 3000;
const TWIN_PORT = 4010;
// The default leaves out slow-ack: with it every notice times out and retries about a dozen times, which
// buries the other bugs. FF_FIXTURE_BUGS=all records the everything-on variant instead.
const DEFAULT_BUGS = 'no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order';
const BUGS = process.env.FF_FIXTURE_BUGS || DEFAULT_BUGS;

async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const probe = http.createServer();
    probe.once('error', () => reject(new Error(`port ${port} is in use; stop whatever is using it and run again`)));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

async function waitUntilUp(url, child) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Coffee Club exited early with code ${child.exitCode}`);
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error('Coffee Club did not start within 60 s');
}

await assertFree(APP_PORT);
await assertFree(TWIN_PORT);

console.log('Building...');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

// Shorten the slow-ack bug and the twin's patience so a run with every bug on finishes in minutes.
process.env.FF_DELIVERY_TIMEOUT_MS = '500';
const { runScenarioFile } = await import('@fastforward/cli');
const { parseScenario } = await import('@fastforward/contracts');

const app = spawn(process.execPath, ['--import', '@fastforward/register', 'examples/coffee-club/dist/server.js'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: {
    ...process.env,
    FASTFORWARD: '1',
    PORT: String(APP_PORT),
    COFFEE_BUGS: BUGS,
    COFFEE_SLOW_MS: '1000',
    FF_AI: 'off',
    // Placeholders: the twin accepts any credentials, and these keep real ones out of the app.
    PAYPAL_CLIENT_ID: 'ff-fixture',
    PAYPAL_CLIENT_SECRET: 'ff-fixture',
    ANTHROPIC_API_KEY: '',
  },
});
const reportDir = mkdtempSync(join(tmpdir(), 'ff-fixture-'));

try {
  await waitUntilUp(`http://127.0.0.1:${APP_PORT}/__ff/probe?subscription_id=none`, app);
  console.log(`Running bad-month.yaml against Coffee Club (COFFEE_BUGS=${BUGS}). This takes a few minutes...`);
  const result = await runScenarioFile(scenarioFile, { ai: null, twinPort: TWIN_PORT, reportDir, fresh: false });

  // customer name -> subscription id, from the CREATED events (Coffee Club sends the email as custom_id).
  const scenario = parseScenario(readFileSync(scenarioFile, 'utf8'));
  const subscriptions = scenario.customers.map((customer) => {
    const created = result.trace.find(
      (t) =>
        t.kind === 'event' &&
        t.event.event_type === 'BILLING.SUBSCRIPTION.CREATED' &&
        (t.event.resource.custom_id === customer.email || t.event.resource.custom_id === customer.name),
    );
    if (!created) throw new Error(`no CREATED event for ${customer.name}; cannot link them to a subscription`);
    return { customer: customer.name, subscriptionId: String(created.event.resource.id) };
  });

  const fixture = {
    recordedAt: new Date().toISOString(),
    recipe: { scenario: 'examples/coffee-club/scenarios/bad-month.yaml', coffeeBugs: BUGS, ai: 'off' },
    runId: result.runId,
    scenario: result.report.scenario,
    start: result.report.start,
    end: result.report.end,
    subscriptions,
    trace: result.trace,
    report: result.report,
  };
  writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n');
  const failed = result.report.checks.filter((c) => c.status === 'fail').map((c) => c.id);
  console.log(`Saved ${outFile}`);
  console.log(`${fixture.trace.length} trace entries, ${result.report.counts.deliveries} deliveries; failed checks: ${failed.join(', ') || 'none'}`);
} finally {
  if (app.exitCode === null) {
    app.kill();
    await new Promise((r) => app.once('exit', r));
  }
  rmSync(reportDir, { recursive: true, force: true });
}
