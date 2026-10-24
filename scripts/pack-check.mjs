#!/usr/bin/env node
/**
 * Proves the packages that would be published actually work for a stranger: bundles them, packs real tarballs,
 * installs those into an empty folder (the only things there are the three packages and their npm dependencies),
 * then runs the bad-month scenario with the packed CLI against Coffee Club preloaded with the packed add-on,
 * and asks the packed MCP server for its tools. Publishes nothing. Needs ports 3000 and 4010 free.
 *   npm run build && npm run pack:check
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });
const runNpm = (args, opts = {}) => {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args], opts);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(npm, args, { encoding: 'utf8', shell: process.platform === 'win32', ...opts });
};
const inUse = (port) => new Promise((done) => { const s = connect(port, '127.0.0.1'); s.once('connect', () => (s.destroy(), done(true))); s.once('error', () => (s.destroy(), done(false))); });
// What each child process wrote to stderr, so a start-up failure says why instead of only that it failed.
const stderrOf = new Map();
const watchStderr = (child, name) => {
  let text = '';
  child.stderr?.on('data', (d) => { text = (text + d).slice(-1500); stderrOf.set(name, text); });
};
async function waitFor(port, what) {
  // 90 s: right after a heavy test run, starting a freshly installed Node program can take well over 30 s.
  for (let i = 0; i < 300; i++) { if (await inUse(port)) return; await new Promise((r) => setTimeout(r, 300)); }
  const why = stderrOf.get(what);
  throw new Error(`${what} did not come up on ${port}${why ? `. Its error output ended with: ${why.trim()}` : ''}`);
}

for (const port of [3000, 4010]) if (await inUse(port)) throw new Error(`port ${port} is in use; stop it first`);
console.log('bundling...');
run(process.execPath, [join(root, 'scripts/bundle.mjs')], { cwd: root, stdio: 'inherit' });

const dir = mkdtempSync(join(tmpdir(), 'ff-pack-'));
const children = [];
let failed = null;
try {
  for (const name of readdirSync(join(root, 'publish'))) runNpm(['pack', '--pack-destination', dir], { cwd: join(root, 'publish', name) });
  const tarballs = readdirSync(dir).filter((f) => f.endsWith('.tgz'));
  console.log('packed:', tarballs.join(', '));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  console.log('installing into an empty folder...');
  runNpm(['install', '--no-audit', '--no-fund', ...tarballs.map((t) => join(dir, t))], { cwd: dir, stdio: 'pipe' });

  const cli = join(dir, 'node_modules/fastforward-cli/bin.js');
  const registerUrl = pathToFileURL(join(dir, 'node_modules/fastforward-register/index.js')).href;
  const env = { ...process.env, FF_AI: 'off', ANTHROPIC_API_KEY: '', PAYPAL_CLIENT_ID: 'ff', PAYPAL_CLIENT_SECRET: 'ff' };

  const twin = spawn(process.execPath, [cli, 'twin', '--port', '4010'], { cwd: dir, env, stdio: ['ignore', 'ignore', 'pipe'] });
  watchStderr(twin, 'packed twin');
  children.push(twin);
  await waitFor(4010, 'packed twin');
  const app = spawn(process.execPath, ['--import', registerUrl, join(root, 'examples/coffee-club/dist/server.js')], {
    cwd: root,
    env: { ...env, FASTFORWARD: '1', PORT: '3000', COFFEE_BUGS: 'no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order', COFFEE_SLOW_MS: '1000' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  watchStderr(app, 'Coffee Club');
  children.push(app);
  await waitFor(3000, 'Coffee Club');

  let out = '';
  try {
    out = run(process.execPath, [cli, 'run', join(root, 'examples/coffee-club/scenarios/bad-month.yaml'), '--twin-url', 'http://127.0.0.1:4010', '--report-dir', join(dir, 'report')], { cwd: dir, env: { ...env, FF_DELIVERY_TIMEOUT_MS: '500' } });
  } catch (err) {
    out = String(err.stdout ?? ''); // exit code 1 means "a check failed", which is the expected result here
  }
  const m = /(\d+) of (\d+) checks failed/.exec(out);
  if (!m || m[1] !== '4') throw new Error(`expected "4 of 6 checks failed" from the packed CLI, got: ${m ? m[0] : out.slice(-300)}`);
  console.log(`packed CLI + packed add-on: ${m[0]}`);

  // MCP over stdio: newline-delimited JSON-RPC.
  const mcp = spawn(process.execPath, [join(dir, 'node_modules/fastforward-mcp/server.js')], { cwd: dir, env, stdio: ['pipe', 'pipe', 'ignore'] });
  children.push(mcp);
  const tools = await new Promise((done, fail) => {
    let buf = '';
    const timer = setTimeout(() => fail(new Error('packed MCP server did not answer tools/list')), 15000);
    mcp.stdout.on('data', (d) => {
      buf += d;
      for (const line of buf.split('\n')) {
        try { const msg = JSON.parse(line); if (msg.id === 2) { clearTimeout(timer); done(msg.result.tools.map((t) => t.name)); } } catch { /* partial line */ }
      }
    });
    const send = (o) => mcp.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'pack-check', version: '1' } } });
    setTimeout(() => { send({ jsonrpc: '2.0', method: 'notifications/initialized' }); send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); }, 500);
  });
  if (tools.sort().join() !== 'ff_explain,ff_run,ff_write_scenario') throw new Error(`unexpected MCP tools: ${tools}`);
  console.log(`packed MCP server tools: ${tools.join(', ')}`);
  console.log('pack-check: OK');
} catch (err) {
  failed = err;
} finally {
  for (const c of children) c.kill();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true });
}
if (failed) { console.error(`pack-check FAILED: ${failed.message}`); process.exit(1); }
