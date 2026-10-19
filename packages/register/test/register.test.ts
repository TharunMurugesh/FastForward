import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from 'selfsigned';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { hostKind, parseTwinUrl } from '../src/redirect.js';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const tsc = fileURLToPath(new URL('../../../node_modules/typescript/bin/tsc', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

interface Seen {
  method: string;
  url: string;
  host: string | undefined;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Stands in for the twin (or any server): records requests, answers like PayPal where a client needs it. */
function recorder(): { seen: Seen[]; handler: http.RequestListener } {
  const seen: Seen[] = [];
  const handler: http.RequestListener = (req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', host: req.headers.host, headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/oauth2/token') {
        res.end(JSON.stringify({ access_token: 'ff', token_type: 'Bearer', expires_in: 32400 }));
      } else if (req.url === '/v2/checkout/orders') {
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 'ORDER-FF', status: 'CREATED' }));
      } else {
        res.end('{}');
      }
    });
  };
  return { seen, handler };
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
}

interface Outcome {
  code: number | null;
  stderr: string;
  json: Record<string, unknown>;
}

/** Runs `node --import @fastforward/register <fixture>` the way an app under test is started. */
function runFixture(name: string, env: Record<string, string | undefined>): Promise<Outcome> {
  const base = { ...process.env };
  delete base.FASTFORWARD;
  delete base.FF_TWIN_URL;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', '@fastforward/register', fixture(name)], {
      cwd: packageDir,
      env: { ...base, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d));
    child.stderr.on('data', (d: Buffer) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => {
      const last = stdout.trim().split('\n').pop() ?? '';
      let json: Record<string, unknown> = {};
      try {
        json = JSON.parse(last) as Record<string, unknown>;
      } catch {
        // leave empty; the assertions will show stderr
      }
      resolve({ code, stderr, json });
    });
  });
}

let twin: http.Server;
let twinUrl: string;
let seen: Seen[];

beforeAll(() => {
  // The add-on is loaded by Node itself, not by Vitest, so the tests run the built output that ships.
  execFileSync(process.execPath, [tsc, '-b', packageDir], { stdio: 'inherit' });
}, 120_000);

beforeAll(async () => {
  const rec = recorder();
  seen = rec.seen;
  twin = http.createServer(rec.handler);
  twinUrl = `http://127.0.0.1:${await listen(twin)}`;
});

afterEach(() => {
  seen.length = 0;
});

afterAll(() => new Promise<void>((resolve) => twin.close(() => resolve())));

describe('register add-on (child processes)', { timeout: 30_000 }, () => {
  it('redirects fetch', async () => {
    const out = await runFixture('client-fetch.mjs', { FASTFORWARD: '1', FF_TWIN_URL: twinUrl });
    expect(out.json, out.stderr).toEqual({ sub: 200, cert: 200 });
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      method: 'POST',
      url: '/v1/billing/subscriptions?page=2',
      host: 'api-m.sandbox.paypal.com',
      body: '{"plan_id":"P-1"}',
    });
    expect(seen[0]?.headers['x-test']).toBe('kept');
    expect(seen[1]).toMatchObject({ method: 'GET', url: '/v1/notifications/certs/CERT-FF-x', host: 'api.sandbox.paypal.com' });
  });

  it('redirects https.request', async () => {
    const out = await runFixture('client-https.mjs', { FASTFORWARD: '1', FF_TWIN_URL: twinUrl });
    expect(out.json, out.stderr).toEqual({ post: 200, cert: 200, plain: 200 });
    expect(seen.map((s) => [s.method, s.url, s.host])).toEqual([
      ['POST', '/v1/billing/subscriptions?page=2', 'api-m.sandbox.paypal.com'],
      ['GET', '/v1/notifications/certs/CERT-FF-x', 'api.sandbox.paypal.com'],
      ['GET', '/v1/billing/plans', 'api-m.sandbox.paypal.com'],
    ]);
    expect(seen[0]?.body).toBe('{"plan_id":"P-1"}');
    expect(seen[0]?.headers['x-test']).toBe('kept');
  });

  it('redirects the official PayPal SDK', async () => {
    const out = await runFixture('client-sdk.mjs', { FASTFORWARD: '1', FF_TWIN_URL: twinUrl });
    expect(out.json, out.stderr).toEqual({ orderId: 'ORDER-FF' });
    expect(seen.map((s) => [s.method, s.url, s.host])).toEqual([
      ['POST', '/v1/oauth2/token', 'api-m.sandbox.paypal.com'],
      ['POST', '/v2/checkout/orders', 'api-m.sandbox.paypal.com'],
    ]);
    expect(seen[1]?.headers.authorization).toBe('Bearer ff');
  });

  it('blocks live PayPal with FastforwardLiveCallError and reports it', async () => {
    const out = await runFixture('client-live.mjs', { FASTFORWARD: '1', FF_TWIN_URL: twinUrl });
    expect(out.json, out.stderr).toEqual({
      leaks: [],
      fetch: 'FastforwardLiveCallError',
      https: 'FastforwardLiveCallError',
      httpsOddCase: 'FastforwardLiveCallError',
    });
    // Each blocked call is reported to the twin; the query string is dropped so secrets never travel.
    expect(seen.map((s) => [s.method, s.url, JSON.parse(s.body)])).toEqual(
      expect.arrayContaining([
        ['POST', '/_ff/live-call', { url: 'https://api-m.paypal.com/v1/oauth2/token' }],
        ['POST', '/_ff/live-call', { url: 'https://api.paypal.com/v1/billing/subscriptions' }],
        ['POST', '/_ff/live-call', { url: 'https://api-m.paypal.com/v2/checkout/orders' }],
      ]),
    );
    expect(seen).toHaveLength(3);
  });

  describe('with a local https server that is not PayPal', () => {
    let local: https.Server;
    let localUrl: string;
    let localSeen: Seen[];
    let caDir: string;
    let caFile: string;

    beforeAll(async () => {
      const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }],
      });
      caDir = mkdtempSync(join(tmpdir(), 'ff-register-'));
      caFile = join(caDir, 'ca.pem');
      writeFileSync(caFile, pems.cert);
      const rec = recorder();
      localSeen = rec.seen;
      local = https.createServer({ key: pems.private, cert: pems.cert }, rec.handler);
      localUrl = `https://127.0.0.1:${await listen(local)}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => local.close(() => resolve()));
      rmSync(caDir, { recursive: true, force: true });
    });

    afterEach(() => {
      localSeen.length = 0;
    });

    it('does nothing when FASTFORWARD is unset', async () => {
      const out = await runFixture('client-local.mjs', { TARGET: localUrl, FF_TWIN_URL: twinUrl, NODE_EXTRA_CA_CERTS: caFile });
      expect(out.json, out.stderr).toEqual({ registered: false, viaFetch: 200, viaHttps: 200 });
      expect(localSeen.map((s) => s.url)).toEqual(['/via-fetch', '/via-https']);
      expect(seen).toHaveLength(0);
    });

    it('leaves hosts other than PayPal alone when active', async () => {
      const out = await runFixture('client-local.mjs', {
        FASTFORWARD: '1',
        TARGET: localUrl,
        FF_TWIN_URL: twinUrl,
        NODE_EXTRA_CA_CERTS: caFile,
      });
      expect(out.json, out.stderr).toEqual({ registered: true, viaFetch: 200, viaHttps: 200 });
      expect(localSeen.map((s) => s.url)).toEqual(['/via-fetch', '/via-https']);
      expect(seen).toHaveLength(0);
    });
  });
});

describe('hostKind', () => {
  it('classifies PayPal hosts regardless of case and trailing dot', () => {
    expect(hostKind('api-m.sandbox.paypal.com')).toBe('sandbox');
    expect(hostKind('API.SANDBOX.PAYPAL.COM.')).toBe('sandbox');
    expect(hostKind('api-m.paypal.com')).toBe('live');
    expect(hostKind('Api.PayPal.com.')).toBe('live');
    expect(hostKind('www.paypal.com')).toBe('other');
    expect(hostKind('api-m.sandbox.paypal.com.evil.test')).toBe('other');
  });
});

describe('parseTwinUrl', () => {
  it('accepts a local twin', () => {
    expect(parseTwinUrl('http://127.0.0.1:4010').origin).toBe('http://127.0.0.1:4010');
  });

  it('refuses PayPal hosts and non-http URLs', () => {
    expect(() => parseTwinUrl('https://api-m.paypal.com')).toThrow(/FF_TWIN_URL/);
    expect(() => parseTwinUrl('https://api-m.sandbox.paypal.com')).toThrow(/FF_TWIN_URL/);
    expect(() => parseTwinUrl('ftp://127.0.0.1')).toThrow(/FF_TWIN_URL/);
    expect(() => parseTwinUrl('not a url')).toThrow(/FF_TWIN_URL/);
  });
});
