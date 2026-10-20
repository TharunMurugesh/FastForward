#!/usr/bin/env node
/**
 * Starts the whole demo in one process tree, for Railway and for `npm run demo`:
 *   - the twin (stand-in PayPal) on 4010
 *   - Coffee Club on 3000, with the register add-on preloaded and FASTFORWARD=1
 *   - the built dashboard on $PORT (default 8080), which also proxies /_ff/* to the twin,
 *     /demo/* to Coffee Club, and serves /fidelity/latest.json
 * With `--run` (or FF_DEMO_RUN=1) it then plays the bad-month scenario once, and the dashboard's
 * front page opens on that run. AI is off and no PayPal sandbox keys are passed on: it needs no .env.
 * Build first: npm run build && npm run build -w @fastforward/web
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
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
const fidelityFile = join(root, 'fidelity/latest.json');

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

/** Resolves when something accepts connections on the port; gives up after ten seconds. */
function waitForPort(port, name) {
  const deadline = Date.now() + 10_000;
  return new Promise((done, reject) => {
    const attempt = () => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        done();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`${name} did not come up on port ${port} within 10 s`));
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

  if (path === '/_ff' || path.startsWith('/_ff/')) return proxy(req, res, TWIN_PORT, req.url);
  if (path === '/demo' || path.startsWith('/demo/')) return proxy(req, res, COFFEE_PORT, (req.url ?? '').slice('/demo'.length) || '/');

  if (path === '/fidelity/latest.json') {
    if (!existsSync(fidelityFile)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(readFileSync(fidelityFile));
  }

  // The front page opens on the demo run, so a visitor with no run id still sees something real.
  if (path === '/' && demoRunId && !url.searchParams.has('run')) {
    res.writeHead(302, { location: `/?run=${demoRunId}` });
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
start('twin', ['packages/cli/dist/bin.js', 'twin', '--port', String(TWIN_PORT)]);
await waitForPort(TWIN_PORT, 'twin').catch((e) => fail(e.message));
start('coffee-club', ['--import', '@fastforward/register', 'examples/coffee-club/dist/server.js'], {
  FASTFORWARD: '1',
  PORT: String(COFFEE_PORT),
  FF_TWIN_URL: `http://127.0.0.1:${TWIN_PORT}`,
  COFFEE_BUGS: bugs,
});
await waitForPort(COFFEE_PORT, 'Coffee Club').catch((e) => fail(e.message));
await new Promise((done, reject) => server.once('error', reject).listen(PORT, '0.0.0.0', done)).catch((e) => fail(e.message));
console.log(`Fastforward is up: dashboard http://localhost:${PORT}  (Coffee Club bugs: ${bugs})`);

if (process.argv.includes('--run') || process.env.FF_DEMO_RUN === '1') {
  console.log('Playing the bad-month scenario once (this takes a little while)...');
  const run = spawn(
    process.execPath,
    ['packages/cli/dist/bin.js', 'run', SCENARIO, '--twin-url', `http://127.0.0.1:${TWIN_PORT}`, '--dashboard-url', `http://localhost:${PORT}`],
    { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  run.stdout.on('data', (d) => {
    output += d;
    process.stdout.write(d);
  });
  run.stderr.on('data', (d) => process.stderr.write(d));
  run.on('exit', () => {
    demoRunId = /[?&]run=([\w-]+)/.exec(output)?.[1] ?? null;
    if (demoRunId) console.log(`\nOpen the dashboard: http://localhost:${PORT}/?run=${demoRunId}`);
  });
}
