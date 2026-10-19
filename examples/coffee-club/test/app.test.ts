import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseBugs } from '../src/bugs.js';
import { createPaypalClient } from '../src/paypal.js';
import { createApp } from '../src/server.js';

interface Call { method: string; path: string; body: string }

/** A local stand-in for PayPal. Accepts both plain paths and the full URLs the SDK sends in proxy mode. */
async function startFakePaypal() {
  const calls: Call[] = [];
  const state = { verify: 'SUCCESS' };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      calls.push({ method: req.method ?? '', path, body: Buffer.concat(chunks).toString() });
      res.setHeader('Content-Type', 'application/json');
      if (path === '/v1/oauth2/token') {
        res.end(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 32400 }));
      } else if (path === '/v1/billing/subscriptions') {
        res.statusCode = 201;
        res.end(JSON.stringify({ id: 'I-TEST1', status: 'APPROVAL_PENDING' }));
      } else if (path === '/v1/notifications/verify-webhook-signature') {
        res.end(JSON.stringify({ verification_status: state.verify }));
      } else if (path.endsWith('/provide-evidence')) {
        res.statusCode = 202;
        res.end('{}');
      } else {
        res.statusCode = 404;
        res.end('{}');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, calls, state, close: () => new Promise<void>((r) => server.close(() => r())) };
}

type Fake = Awaited<ReturnType<typeof startFakePaypal>>;
let fake: Fake;
let app: http.Server | undefined;
let base: string;

async function startApp(bugs = 'none', slowMs = 12000) {
  const paypal = createPaypalClient({ clientId: 'id', clientSecret: 'secret', apiBase: fake.url });
  const express = createApp({ paypal, bugs: parseBugs(bugs), planId: 'P-COFFEE', webhookId: 'WH-FF-LOCAL', slowMs });
  const server = express.listen(0, '127.0.0.1');
  app = server;
  await new Promise<void>((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  fake = await startFakePaypal();
});
afterEach(async () => {
  const server = app;
  app = undefined;
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await fake.close();
});

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const probe = async (id: string) =>
  (await (await fetch(`${base}/__ff/probe?subscription_id=${id}`)).json()) as { access: boolean; fulfilments: number };

const event = (id: string, type: string, resource: Record<string, unknown>) => ({ id, event_type: type, resource });
const activated = (id = 'WH-1') => event(id, 'BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-TEST1' });
const sale = (id: string) => event(id, 'PAYMENT.SALE.COMPLETED', { id: 'SALE-1', billing_agreement_id: 'I-TEST1' });
const suspended = (id = 'WH-S') => event(id, 'BILLING.SUBSCRIPTION.SUSPENDED', { id: 'I-TEST1' });
const headers = {
  'paypal-transmission-id': 'T1',
  'paypal-transmission-sig': 'sig',
  'paypal-cert-url': 'https://x',
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-transmission-time': 'now',
};
const deliver = (e: unknown) =>
  fetch(base + '/webhooks/paypal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(e),
  });

async function subscribe() {
  const res = await post('/subscribe', { name: 'Maya', email: 'maya@example.test' });
  return (await res.json()) as { subscription_id: string };
}

describe('Coffee Club', () => {
  it('subscribe returns subscription id', async () => {
    await startApp();
    const res = await post('/subscribe', { name: 'Maya', email: 'maya@example.test' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscription_id: 'I-TEST1' });
    const created = fake.calls.find((c) => c.path === '/v1/billing/subscriptions');
    expect(JSON.parse(created!.body)).toMatchObject({ plan_id: 'P-COFFEE', custom_id: 'maya@example.test' });
  });

  it('probe answers 404 for unknown ids', async () => {
    await startApp();
    expect((await fetch(`${base}/__ff/probe?subscription_id=I-NOPE`)).status).toBe(404);
  });

  it('sale completed twice with same event id fulfils once', async () => {
    await startApp();
    await subscribe();
    await deliver(sale('WH-A'));
    await deliver(sale('WH-A'));
    expect(await probe('I-TEST1')).toEqual({ access: true, fulfilments: 1 });
  });

  it('with no-dedupe fulfils twice', async () => {
    await startApp('no-dedupe');
    await subscribe();
    await deliver(sale('WH-A'));
    await deliver(sale('WH-A'));
    expect((await probe('I-TEST1')).fulfilments).toBe(2);
  });

  it('suspended turns access off', async () => {
    await startApp();
    await subscribe();
    await deliver(activated());
    expect((await probe('I-TEST1')).access).toBe(true);
    await deliver(suspended());
    expect((await probe('I-TEST1')).access).toBe(false);
  });

  it('with ignores-suspend access stays on', async () => {
    await startApp('ignores-suspend');
    await subscribe();
    await deliver(activated());
    await deliver(suspended());
    expect((await probe('I-TEST1')).access).toBe(true);
  });

  it('rejects event when verify returns FAILURE (no state change)', async () => {
    await startApp();
    await subscribe();
    fake.state.verify = 'FAILURE';
    const res = await deliver(activated());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await probe('I-TEST1')).access).toBe(false);
  });

  it('with no-verify accepts it', async () => {
    await startApp('no-verify');
    await subscribe();
    fake.state.verify = 'FAILURE';
    expect((await deliver(activated())).status).toBe(200);
    expect((await probe('I-TEST1')).access).toBe(true);
    expect(fake.calls.some((c) => c.path.includes('verify-webhook-signature'))).toBe(false);
  });

  it('verifies with the configured webhook id and the delivery headers', async () => {
    await startApp();
    await subscribe();
    await deliver(activated());
    const verify = fake.calls.find((c) => c.path.includes('verify-webhook-signature'))!;
    expect(JSON.parse(verify.body)).toMatchObject({
      webhook_id: 'WH-FF-LOCAL',
      transmission_id: 'T1',
      webhook_event: { id: 'WH-1' },
    });
  });

  it('dispute created calls provide-evidence', async () => {
    await startApp();
    await deliver(event('WH-D', 'CUSTOMER.DISPUTE.CREATED', { dispute_id: 'PP-D-1' }));
    const call = fake.calls.find((c) => c.path === '/v1/customer/disputes/PP-D-1/provide-evidence');
    expect(call).toBeDefined();
    expect(call!.body).toContain('1Z999AA10123456784');
  });

  it('with ignores-disputes does not answer', async () => {
    await startApp('ignores-disputes');
    await deliver(event('WH-D', 'CUSTOMER.DISPUTE.CREATED', { dispute_id: 'PP-D-1' }));
    expect(fake.calls.some((c) => c.path.includes('provide-evidence'))).toBe(false);
  });

  it('with slow-ack replies after COFFEE_SLOW_MS', async () => {
    await startApp('slow-ack', 300);
    await subscribe();
    const t0 = Date.now();
    await deliver(activated());
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
  });

  it('replies fast without slow-ack', async () => {
    await startApp('none', 300);
    await subscribe();
    const t0 = Date.now();
    await deliver(activated());
    expect(Date.now() - t0).toBeLessThan(250);
  });
});

describe('parseBugs', () => {
  it('handles none, all, lists and typos', () => {
    expect(parseBugs(undefined).size).toBe(0);
    expect(parseBugs('all').size).toBe(5);
    expect([...parseBugs('no-verify, slow-ack')]).toEqual(['no-verify', 'slow-ack']);
    expect(() => parseBugs('no-verfy')).toThrow(/no-verfy/);
  });
});
