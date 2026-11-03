#!/usr/bin/env node
/**
 * Starts the whole demo in one process tree, for Railway and for `npm run demo`:
 *   - the twin (stand-in PayPal) on 4010
 *   - Coffee Club on 3000, with the register add-on preloaded and FASTFORWARD=1
 *   - the built dashboard on $PORT (default 8080), which also proxies /_ff/* to the twin,
 *     /demo/* to Coffee Club, and serves the evidence in fidelity/
 * With `--run` (or FF_DEMO_RUN=1) it then plays the bad-month scenario once, and the dashboard's
 * front page opens on that run. With `--local` (only `npm run demo` passes it, never the Dockerfile) the page can
 * also start a fresh run, with Coffee Club's planted bugs switched on or off: POST /_local/run. AI is off and no PayPal sandbox keys are passed on: it needs no .env.
 * Build first: npm run build && npm run build -w @fastforward/web
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TWIN_PORT = Number(process.env.FF_TWIN_PORT ?? 4010);
const COFFEE_PORT = Number(process.env.FF_COFFEE_PORT ?? 3000);
const PORT = Number(process.env.PORT ?? 8080);
const SCENARIO = process.env.FF_SCENARIO ?? 'examples/coffee-club/scenarios/bad-month.yaml';
const DEFAULT_BUGS = 'no-verify,no-dedupe,ignores-suspend,ignores-disputes,trusts-event-order';
const webDir = join(root, 'apps/web/dist/app');
const evidence = { '/fidelity/latest.json': join(root, 'fidelity/latest.json'), '/fidelity/real-report.json': join(root, 'fidelity/real-report.json') };

const children = [];
const fail = (message) => {
  console.error(`start-hosted: ${message}`);
  for (const child of children) child.kill();
  process.exit(1);
};

for (const [path, hint] of [
  [join(root, 'packages/cli/dist/bin.js'), 'npm run build'],
  [join(root, 'examples/coffee-club/dist/server.js'), 'npm run build'],
  [join(webDir, 'index.html'), 'npm run build -w @fastforward/web'],
]) {
  if (!existsSync(path)) fail(`${path} is missing. Run: ${hint}`);
}

// Never pass sandbox keys or an Anthropic key down: the hosted demo is offline on purpose.
const childEnv = { ...process.env, FF_AI: 'off' };
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'ANTHROPIC_API_KEY']) delete childEnv[key];

let shuttingDown = false;
function start(name, args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...childEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream) => stream.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  pipe(child.stdout);
  pipe(child.stderr);
  child.on('exit', (code) => {
    if (!shuttingDown) fail(`${name} stopped unexpectedly (exit ${code})`);
  });
  children.push(child);
  return child;
}

function shutdown() {
  shuttingDown = true;
  for (const child of children) child.kill();
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/** Resolves when something accepts connections on the port; gives up after thirty seconds (a busy host starts slowly). */
function waitForPort(port, name) {
  const deadline = Date.now() + 30_000;
  return new Promise((done, reject) => {
    const attempt = () => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        done();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`${name} did not come up on port ${port} within 30 s`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

let demoRunId = null;
const LOCAL = process.argv.includes('--local');
let localBusy = false;
let bugsOn = true;
/** Local mode only: the Anthropic key from .env, so the page can ask for one live Claude run. Never passed on otherwise. */
let liveKey = null;
if (LOCAL) {
  try {
    liveKey = /^ANTHROPIC_API_KEY=(.+)$/m.exec(readFileSync(join(root, '.env'), 'utf8'))?.[1]?.trim().replace(/^["']|["']$/g, '') || null;
  } catch {
    // no .env: live Claude is simply not offered
  }
}

/** Forwards the request untouched (streams included, so the dashboard's event stream works). */
function proxy(req, res, port, path) {
  const upstream = request({ host: '127.0.0.1', port, path, method: req.method, headers: req.headers }, (up) => {
    res.writeHead(up.statusCode ?? 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('upstream not reachable');
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (LOCAL && path === '/_local') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ bugsOn, busy: localBusy, claudeAvailable: Boolean(liveKey) }));
  }
  if (LOCAL && path === '/_local/run' && req.method === 'POST') return localRun(req, res);

  // The public site only reads. The twin's control API can start and advance runs, and Coffee Club
  // accepts subscriptions, so anything that is not GET or HEAD is refused before it reaches them.
  const readOnly = req.method === 'GET' || req.method === 'HEAD';
  if ((path === '/_ff' || path.startsWith('/_ff/') || path === '/demo' || path.startsWith('/demo/')) && !readOnly) {
    res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
    return res.end('this demo is read-only');
  }
  if (path === '/_ff' || path.startsWith('/_ff/')) return proxy(req, res, TWIN_PORT, req.url);
  if (path === '/demo' || path.startsWith('/demo/')) return proxy(req, res, COFFEE_PORT, (req.url ?? '').slice('/demo'.length) || '/');

  if (Object.hasOwn(evidence, path)) {
    if (!existsSync(evidence[path])) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(readFileSync(evidence[path]));
  }

  // The front page opens on the demo run, so a visitor with no run id still sees something real.
  if (path === '/' && demoRunId && !url.searchParams.has('run')) {
    res.writeHead(302, { location: `/?run=${demoRunId}${url.searchParams.has('embed') ? '&embed=1' : ''}` });
    return res.end();
  }

  const file = normalize(join(webDir, path === '/' ? 'index.html' : decodeURIComponent(path)));
  const inside = file.startsWith(webDir + sep);
  const found = inside && existsSync(file) && statSync(file).isFile() ? file : join(webDir, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(found)] ?? 'application/octet-stream' });
  res.end(readFileSync(found));
});

/** True when something already listens on the port: a second copy would silently talk to the first. */
const inUse = (port) =>
  new Promise((done) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => (socket.destroy(), done(true)));
    socket.once('error', () => (socket.destroy(), done(false)));
  });
for (const [port, name] of [[TWIN_PORT, 'the twin'], [COFFEE_PORT, 'Coffee Club'], [PORT, 'the dashboard']]) {
  if (await inUse(port)) fail(`port ${port} is already in use, so ${name} cannot start. Stop the other process first.`);
}

const bugs = process.env.COFFEE_BUGS ?? DEFAULT_BUGS;
bugsOn = bugs !== 'none';
// The twin decides what the customers do. Pointed at the scenario's recorded decisions, a demo with no API key repeats
// exactly the recorded run (bad-month.lock.json is committed once someone has recorded it with `npm run record:ai`).
start('twin', ['packages/cli/dist/bin.js', 'twin', '--port', String(TWIN_PORT), '--decisions', SCENARIO.replace(/\.ya?ml$/, '.lock.json')]);
await waitForPort(TWIN_PORT, 'twin').catch((e) => fail(e.message));
start('coffee-club', ['--import', 'fastforward-register', 'examples/coffee-club/dist/server.js'], {
  FASTFORWARD: '1',
  PORT: String(COFFEE_PORT),
  FF_TWIN_URL: `http://127.0.0.1:${TWIN_PORT}`,
  COFFEE_BUGS: bugs,
});
await waitForPort(COFFEE_PORT, 'Coffee Club').catch((e) => fail(e.message));
await new Promise((done, reject) => server.once('error', reject).listen(PORT, '0.0.0.0', done)).catch((e) => fail(e.message));
console.log(`Fastforward is up: dashboard http://localhost:${PORT}  (Coffee Club bugs: ${bugs})`);

/**
 * Plays a scenario once through the twin. Resolves with the run's id, or with the tool's own error line when it
 * stopped (for example "can't reach your app"), so the page can say what went wrong.
 */
function playScenario(file = SCENARIO, env = childEnv) {
  return new Promise((done) => {
    const run = spawn(
      process.execPath,
      ['packages/cli/dist/bin.js', 'run', file, '--twin-url', `http://127.0.0.1:${TWIN_PORT}`, '--dashboard-url', `http://localhost:${PORT}`],
      { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    let errors = '';
    run.stdout.on('data', (d) => {
      output += d;
      process.stdout.write(d);
    });
    run.stderr.on('data', (d) => {
      errors += d;
      process.stderr.write(d);
    });
    run.on('exit', () => {
      const runId = /[?&]run=([\w-]+)/.exec(output)?.[1] ?? null;
      const error = errors.trim().split('\n').at(-1)?.replace(/^fastforward:\s*/, '') || 'the run did not finish; see the terminal';
      done(runId ? { runId } : { error });
    });
  });
}

const LOCAL_DIR = join(root, '.fastforward', 'local');
const localHost = (value) => {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
};

/**
 * A copy of the demo scenario for this run: pointed at another app if one is given, with fresh ids, and with
 * the recorded customer decisions copied beside it unless Claude is to decide live.
 */
function localScenario(name, app, claudeLive) {
  let text = readFileSync(SCENARIO, 'utf8').replace(/^name: .*$/m, `name: ${name}`).replace(/^ids: repeat\s*$/m, '');
  if (app) {
    text = text
      .replace(/^(\s*webhookUrl:).*$/m, `$1 ${app.webhookUrl}`)
      .replace(/^(\s*subscribeUrl:).*$/m, `$1 ${app.subscribeUrl}`)
      .replace(/^(\s*probeUrl:).*$/m, `$1 ${app.probeUrl}`);
  }
  mkdirSync(LOCAL_DIR, { recursive: true });
  const file = join(LOCAL_DIR, `${name}.yaml`);
  writeFileSync(file, text);
  const lock = join(LOCAL_DIR, `${name}.lock.json`);
  rmSync(lock, { force: true });
  rmSync(join(LOCAL_DIR, `${name}.narration.lock.json`), { force: true });
  const recorded = SCENARIO.replace(/\.ya?ml$/, '.lock.json');
  if (!claudeLive && existsSync(recorded)) copyFileSync(recorded, lock);
  return file;
}

/**
 * POST /_local/run {bugsOn, app?, claudeLive?}: play a fresh month and answer with its run id, one at a time.
 * Without `app` it tests Coffee Club with its planted bugs on or off. With `app` it tests that app instead, which
 * must run on this machine with the register add-on. `claudeLive` lets Claude decide afresh with the key in .env.
 */
async function localRun(req, res) {
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (localBusy) return reply(409, { error: 'a run is already playing' });
  localBusy = true;
  try {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (text.length > 1000) return reply(413, { error: 'too large' });
    }
    const body = JSON.parse(text || '{}');
    const claudeLive = body.claudeLive === true;
    if (claudeLive && !liveKey) return reply(400, { error: 'Claude live needs ANTHROPIC_API_KEY in .env' });
    let app = null;
    if (body.app) {
      app = { webhookUrl: String(body.app.webhookUrl ?? ''), subscribeUrl: String(body.app.subscribeUrl ?? ''), probeUrl: String(body.app.probeUrl ?? '') };
      // Only apps on this machine: the page must not be able to send the twin's traffic anywhere else.
      if (!Object.values(app).every(localHost)) return reply(400, { error: 'your app must run on this machine: use http://localhost:<port>/... addresses' });
    } else {
      const wanted = body.bugsOn !== false;
      const set = await fetch(`http://127.0.0.1:${COFFEE_PORT}/__ff/bugs`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bugs: wanted ? bugs : 'none' }),
      });
      if (!set.ok) return reply(502, { error: 'Coffee Club did not accept the bug switch' });
      // The demo scenario repeats its ids, so the shop must forget the last run or it double-counts.
      const reset = await fetch(`http://127.0.0.1:${COFFEE_PORT}/__ff/reset`, { method: 'POST' });
      if (!reset.ok) return reply(502, { error: 'Coffee Club could not start afresh' });
      bugsOn = wanted;
    }
    const file = app || claudeLive ? localScenario(app ? 'your-app' : 'coffee-club-live', app, claudeLive) : SCENARIO;
    const env = claudeLive ? { ...childEnv, FF_AI: 'on', ANTHROPIC_API_KEY: liveKey } : childEnv;
    const result = await playScenario(file, env);
    if (!result.runId) return reply(422, { error: result.error });
    demoRunId = result.runId;
    return reply(200, { runId: result.runId });
  } catch (err) {
    return reply(400, { error: err.message });
  } finally {
    localBusy = false;
  }
}

if (process.argv.includes('--run') || process.env.FF_DEMO_RUN === '1') {
  console.log('Playing the bad-month scenario once (this takes a little while)...');
  demoRunId = (await playScenario()).runId ?? null;
  if (demoRunId) console.log(`\nOpen the dashboard: http://localhost:${PORT}/?run=${demoRunId}`);
}
if (LOCAL) console.log('Local mode: the page can start fresh runs with the planted bugs on or off.');
