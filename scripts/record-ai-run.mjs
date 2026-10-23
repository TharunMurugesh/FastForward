#!/usr/bin/env node
/**
 * Records one real run of the bad month with Claude playing the customers and writing the explanations, and saves
 * what the model decided and wrote next to the scenario:
 *   examples/coffee-club/scenarios/bad-month.lock.json            customer decisions
 *   examples/coffee-club/scenarios/bad-month.narration.lock.json  failure explanations
 * Commit those two files and the hosted demo (and anyone with no API key) replays exactly this run.
 *
 * THIS SPENDS MONEY on your Anthropic key, so it does nothing unless you pass --yes. The spend is capped by
 * FF_AI_MAX_CALLS (default 60 here), and the run prints how many calls and tokens it used.
 *
 *   npm run build
 *   npm run record:ai            shows what it would do, costs nothing
 *   npm run record:ai -- --yes   does it
 *
 * The key comes from .env (ANTHROPIC_API_KEY). It is given to the command-line tool only, never to the example app.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIO = 'examples/coffee-club/scenarios/bad-month.yaml';
const DEMO_BUGS = 'no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order';
const APP_PORT = 3000;
const TWIN_PORT = 4010;
const yes = process.argv.includes('--yes');

try {
  process.loadEnvFile(join(root, '.env'));
} catch {
  // no .env: the key may already be in the environment
}
const hasKey = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
const cap = process.env.FF_AI_MAX_CALLS ?? '60';

console.log('Record a real AI run of the bad month');
console.log(`  scenario:      ${SCENARIO}`);
console.log(`  model:         claude-opus-5-5 (customers at low effort, explanations at medium)`);
console.log(`  spend cap:     ${cap} model calls (FF_AI_MAX_CALLS)`);
console.log(`  API key:       ${hasKey ? 'found in .env or the environment (not shown)' : 'NOT FOUND: put ANTHROPIC_API_KEY in .env'}`);
console.log(`  will write:    bad-month.lock.json and bad-month.narration.lock.json next to the scenario (existing ones are replaced)`);

if (!yes) {
  console.log('\nNothing was run and nothing was spent. To record for real: npm run record:ai -- --yes');
  process.exit(0);
}
if (!hasKey) {
  console.error('\nNo ANTHROPIC_API_KEY. Put it in .env (never paste it in chat or commit it) and run again.');
  process.exit(2);
}
if (!/^[1-9][0-9]*$/.test(cap)) {
  console.error(`\nFF_AI_MAX_CALLS must be a whole number of at least 1, got "${cap}".`);
  process.exit(2);
}
for (const file of ['packages/cli/dist/bin.js', 'examples/coffee-club/dist/server.js']) {
  if (!existsSync(join(root, file))) {
    console.error(`\n${file} is missing. Run: npm run build`);
    process.exit(2);
  }
}

const inUse = (port) =>
  new Promise((done) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), done(true)));
    s.once('error', () => (s.destroy(), done(false)));
  });
for (const port of [APP_PORT, TWIN_PORT]) {
  if (await inUse(port)) {
    console.error(`\nPort ${port} is already in use. Stop whatever is using it and run again.`);
    process.exit(2);
  }
}

async function waitFor(port) {
  for (let i = 0; i < 100; i += 1) {
    if (await inUse(port)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`nothing came up on port ${port}`);
}

// The example app gets placeholder PayPal credentials and no Anthropic key: only the command-line tool may spend.
const appEnv = {
  ...process.env,
  FASTFORWARD: '1',
  PORT: String(APP_PORT),
  FF_TWIN_URL: `http://127.0.0.1:${TWIN_PORT}`,
  COFFEE_BUGS: DEMO_BUGS,
  FF_AI: 'off',
  PAYPAL_CLIENT_ID: 'ff-record',
  PAYPAL_CLIENT_SECRET: 'ff-record',
  ANTHROPIC_API_KEY: '',
};
const app = spawn(process.execPath, ['--import', 'fastforward-register', 'examples/coffee-club/dist/server.js'], { cwd: root, env: appEnv, stdio: ['ignore', 'ignore', 'inherit'] });
const reportDir = mkdtempSync(join(tmpdir(), 'ff-record-'));
let code = 1;
try {
  await waitFor(APP_PORT);
  console.log('\nRecording (this calls the model)...\n');
  code = await new Promise((done) => {
    const cli = spawn(process.execPath, ['packages/cli/dist/bin.js', 'run', SCENARIO, '--fresh', '--report-dir', reportDir], {
      cwd: root,
      env: { ...process.env, FF_AI_MAX_CALLS: cap, FF_DELIVERY_TIMEOUT_MS: '500' },
      stdio: 'inherit',
    });
    cli.on('exit', (c) => done(c ?? 1));
  });
} finally {
  app.kill();
  rmSync(reportDir, { recursive: true, force: true });
}

// The command exits 1 when a check failed, which is the expected result for the demo bugs.
if (code === 2) {
  console.error('\nThe run could not complete. Nothing was recorded.');
  process.exit(2);
}
const written = ['bad-month.lock.json', 'bad-month.narration.lock.json'].filter((f) => existsSync(join(root, 'examples/coffee-club/scenarios', f)));
console.log(`\nSaved: ${written.length > 0 ? written.join(', ') : 'nothing (the model did not decide or write anything)'}`);
console.log('Look at the AI line above for the calls and tokens used. Review the two files, then commit them to make the demo replay this run.');
