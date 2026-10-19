import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTwin, newId, type Twin } from '../src/index.js';

interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  body: string;
}

/** A stand-in for the real PayPal sandbox: issues token `UP-TOKEN` and records every request. */
async function startUpstream(): Promise<{ url: string; seen: Seen[]; tokenCalls: () => number; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  let tokenCalls = 0;
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    seen.push({ method: req.method ?? '', url: req.url ?? '', authorization: req.headers.authorization, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/oauth2/token') {
      tokenCalls += 1;
      const expected = `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`;
      if (req.headers.authorization !== expected) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'invalid_client' }));
        return;
      }
      res.end(JSON.stringify({ access_token: 'UP-TOKEN', token_type: 'Bearer', expires_in: 32400 }));
      return;
    }
    if (req.headers.authorization !== 'Bearer UP-TOKEN') {
      res.statusCode = 401;
      res.end(JSON.stringify({ name: 'AUTHENTICATION_FAILURE' }));
      return;
    }
    if (req.url?.startsWith('/v1/missing')) {
      res.statusCode = 404;
      res.end(JSON.stringify({ name: 'RESOURCE_NOT_FOUND' }));
      return;
    }
    res.end(JSON.stringify({ echoed: { method: req.method, url: req.url, body } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    tokenCalls: () => tokenCalls,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const creds = { clientId: 'client-id', clientSecret: 'client-secret' };
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const json = { 'content-type': 'application/json' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

async function twinWith(opts: Parameters<typeof createTwin>[0] = {}): Promise<Twin> {
  const twin = await createTwin({ port: 0, ...opts });
  cleanup.push(() => twin.close());
  return twin;
}

describe('token', () => {
  it('issues a token for any credentials', async () => {
    const twin = await twinWith();
    const res = await fetch(`${twin.url}/v1/oauth2/token`, {
      method: 'POST',
      headers: { authorization: basic('x', 'y'), 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.token_type).toBe('Bearer');
    expect(body.expires_in).toBe(32400);
    expect(typeof body.access_token).toBe('string');
  });

  it('issues a token even with no credentials and no body', async () => {
    const twin = await twinWith();
    const res = await fetch(`${twin.url}/v1/oauth2/token`, { method: 'POST' });
    expect(res.status).toBe(200);
  });
});

describe('passthrough', () => {
  it('passes unknown /v1 and /v2 routes to upstream with the twin own sandbox token', async () => {
    const upstream = await startUpstream();
    cleanup.push(upstream.close);
    const twin = await twinWith({ upstreamBase: upstream.url, sandboxCreds: creds });

    const v1 = await fetch(`${twin.url}/v1/reporting/transactions?page=2`, { headers: { authorization: 'Bearer APP-TOKEN' } });
    expect(v1.status).toBe(200);
    expect(await v1.json()).toEqual({ echoed: { method: 'GET', url: '/v1/reporting/transactions?page=2', body: '' } });

    const v2 = await fetch(`${twin.url}/v2/payments/captures/ABC`, { headers: { authorization: 'Bearer APP-TOKEN' } });
    expect(v2.status).toBe(200);

    // The twin fetched its own token once (cached for the second call); the app's token never left the machine.
    expect(upstream.tokenCalls()).toBe(1);
    const forwarded = upstream.seen.filter((s) => s.url !== '/v1/oauth2/token');
    expect(forwarded.map((s) => s.authorization)).toEqual(['Bearer UP-TOKEN', 'Bearer UP-TOKEN']);
  });

  it('forwards method, JSON body and upstream error status', async () => {
    const upstream = await startUpstream();
    cleanup.push(upstream.close);
    const twin = await twinWith({ upstreamBase: upstream.url, sandboxCreds: creds });

    const post = await fetch(`${twin.url}/v2/checkout/orders`, { method: 'POST', headers: json, body: '{"intent": "CAPTURE"}' });
    expect(await post.json()).toEqual({ echoed: { method: 'POST', url: '/v2/checkout/orders', body: '{"intent": "CAPTURE"}' } });

    const missing = await fetch(`${twin.url}/v1/missing/thing`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ name: 'RESOURCE_NOT_FOUND' });
  });

  it('answers 501 when there are no sandbox credentials', async () => {
    const upstream = await startUpstream();
    cleanup.push(upstream.close);
    const twin = await twinWith({ upstreamBase: upstream.url });
    const res = await fetch(`${twin.url}/v1/reporting/transactions`);
    expect(res.status).toBe(501);
    expect(upstream.seen).toEqual([]);
  });

  it('answers 502 when the sandbox rejects the twin credentials', async () => {
    const upstream = await startUpstream();
    cleanup.push(upstream.close);
    const twin = await twinWith({ upstreamBase: upstream.url, sandboxCreds: { clientId: 'wrong', clientSecret: 'wrong' } });
    const res = await fetch(`${twin.url}/v1/reporting/transactions`);
    expect(res.status).toBe(502);
  });
});

describe('safety', () => {
  it.each([
    'https://api-m.paypal.com',
    'https://api.paypal.com',
    'https://api-m.sandbox.paypal.com.evil.test',
    'https://api-m.sandbox.paypal.com@evil.test',
    'http://api-m.sandbox.paypal.com',
    'https://example.com',
    'not a url',
  ])('never targets %s', async (upstreamBase) => {
    await expect(createTwin({ port: 0, upstreamBase })).rejects.toThrow(/upstream/i);
  });

  it('accepts the sandbox host and local hosts', async () => {
    await twinWith({ upstreamBase: 'https://api-m.sandbox.paypal.com' });
    await twinWith({ upstreamBase: 'http://127.0.0.1:9' });
    await twinWith({ upstreamBase: 'http://localhost:9' });
  });
});

describe('runs', () => {
  // A run now really starts (subscriptions, first webhooks), so it needs a full scenario and an app that answers.
  const webhookApp: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => res.end());
  });
  const scenario = {
    name: 'stub',
    seed: 1,
    start: '2026-11-01T00:00:00.000Z',
    durationDays: 30,
    app: { webhookUrl: '', webhookId: 'WH-FF-LOCAL' },
    plan: { name: 'Basic', price: '5.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
    customers: [{ name: 'Sam', email: 'sam@example.test', persona: '', card: { kind: 'ok' }, actions: [] }],
    weather: { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false },
    expect: { accessWhile: ['ACTIVE'] },
  };
  beforeAll(async () => {
    await new Promise<void>((resolve) => webhookApp.listen(0, '127.0.0.1', resolve));
    scenario.app.webhookUrl = `http://127.0.0.1:${(webhookApp.address() as AddressInfo).port}/webhooks/paypal`;
  });
  afterAll(() => new Promise<void>((resolve) => webhookApp.close(() => resolve())));
  const postRun = (twin: Twin, body: string) => fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers: json, body });

  it('second run returns 409', async () => {
    const twin = await twinWith();
    const first = await postRun(twin, JSON.stringify({ scenario }));
    expect(first.status).toBe(201);
    const { runId } = (await first.json()) as { runId: string };
    expect(twin.activeRun()?.id).toBe(runId);

    const second = await postRun(twin, JSON.stringify({ scenario }));
    expect(second.status).toBe(409);
  });

  it('rejects a run without a scenario', async () => {
    const twin = await twinWith();
    const res = await postRun(twin, '{}');
    expect(res.status).toBe(400);
    expect(twin.activeRun()).toBeNull();
  });

  it('live-call appends live_call_blocked to the active run trace', async () => {
    const twin = await twinWith();
    await postRun(twin, JSON.stringify({ scenario }));
    const res = await fetch(`${twin.url}/_ff/live-call`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ url: 'https://api-m.paypal.com/v1/billing/subscriptions' }),
    });
    expect(res.status).toBe(204);
    expect(twin.activeRun()?.trace).toContainEqual({
      at: '2026-11-01T00:00:00.000Z',
      kind: 'live_call_blocked',
      url: 'https://api-m.paypal.com/v1/billing/subscriptions',
    });
  });

  it('live-call with no active run answers 404', async () => {
    const twin = await twinWith();
    const res = await fetch(`${twin.url}/_ff/live-call`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ url: 'https://api.paypal.com/x' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('ids', () => {
  it('newId produces PayPal-like uppercase ids', () => {
    expect(newId('I')).toMatch(/^I-[A-Z0-9]{12}$/);
    expect(newId('P')).toMatch(/^P-[A-Z0-9]{24}$/);
    expect(newId('PROD')).toMatch(/^PROD-[A-Z0-9]{17}$/);
    expect(newId('WH')).toMatch(/^WH-[A-Z0-9]{17}-[A-Z0-9]{17}$/);
    expect(newId('PP-D')).toMatch(/^PP-D-\d{5}$/);
    expect(newId('SALE')).toMatch(/^[A-Z0-9]{17}$/);
    expect(new Set(Array.from({ length: 500 }, () => newId('I'))).size).toBe(500);
  });
});
