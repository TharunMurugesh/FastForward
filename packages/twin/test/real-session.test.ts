import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Customer, CustomerDecision, DecisionBy, Scenario } from '@fastforward/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createTwin, pickRealCustomer, RealSession, type DecisionContext, type Twin } from '../src/index.js';
import { FakeApp } from './support/fake-app.js';

const leo: Customer = { name: 'Leo', email: 'leo@example.test', persona: 'Busy, rarely reads email.', card: { kind: 'fails_from', date: '2026-12-01' }, actions: [] };

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));
const listen = (server: Server) => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));

async function readBody(req: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** A stand-in for the real sandbox: answers the session's calls and posts a signed-looking notice for each action. */
function fakeSandbox(opts: { rejectAt?: string; silent?: string; refuseResendTimes?: number } = {}) {
  let resendRefusals = opts.refuseResendTimes ?? 0;
  const calls: { method: string; url: string; body: string }[] = [];
  const verifyBodies: Record<string, any>[] = [];
  const events = new Map<string, { type: string; resource: string }>();
  let hookUrl = '';
  let serial = 0;

  const notify = (type: string, resource: string, eventId = `WH-${++serial}`) => {
    events.set(eventId, { type, resource });
    if (type === opts.silent) return;
    setTimeout(() => {
      void fetch(hookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'paypal-transmission-id': `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`,
          'paypal-transmission-sig': 'c2ln',
          'paypal-transmission-time': '2026-11-01T02:21:53Z',
          'paypal-auth-algo': 'SHA256withRSA',
          'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-REAL',
        },
        body: JSON.stringify({ id: eventId, event_type: type, resource: { id: resource } }),
      }).catch(() => {});
    }, 5);
  };

  const server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url ?? '';
    calls.push({ method: req.method ?? '', url, body });
    const send = (status: number, json?: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(json === undefined ? undefined : JSON.stringify(json));
    };
    if (opts.rejectAt && url.includes(opts.rejectAt)) return send(422, { name: 'UNPROCESSABLE_ENTITY' });
    if (url === '/v1/oauth2/token') return send(200, { access_token: 'REAL-TOKEN', expires_in: 300 });
    if (url === '/v1/notifications/webhooks') {
      hookUrl = JSON.parse(body).url;
      return send(201, { id: 'REAL-WEBHOOK-ID' });
    }
    if (url.startsWith('/v1/notifications/webhooks/')) return send(204);
    if (url === '/v1/notifications/verify-webhook-signature') {
      const parsed = JSON.parse(body);
      verifyBodies.push(parsed);
      return send(200, { verification_status: parsed.webhook_id === 'REAL-WEBHOOK-ID' ? 'SUCCESS' : 'FAILURE' });
    }
    if (url.startsWith('/v1/notifications/certs/')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('REAL-CERT');
    }
    if (url === '/v1/catalogs/products') return send(201, { id: 'PROD-1' });
    if (url === '/v1/billing/plans') return send(201, { id: 'P-1' });
    if (req.method === 'GET' && url === '/v1/billing/subscriptions/I-REAL') return send(200, { id: 'I-REAL', status: 'ACTIVE' });
    if (url === '/v1/billing/subscriptions') {
      notify('BILLING.SUBSCRIPTION.ACTIVATED', 'I-REAL');
      return send(201, { id: 'I-REAL', status: 'ACTIVE' });
    }
    const action = /subscriptions\/I-REAL\/(suspend|activate|cancel)$/.exec(url)?.[1];
    if (action) {
      notify({ suspend: 'BILLING.SUBSCRIPTION.SUSPENDED', activate: 'BILLING.SUBSCRIPTION.ACTIVATED', cancel: 'BILLING.SUBSCRIPTION.CANCELLED' }[action]!, 'I-REAL');
      return send(204);
    }
    const resend = /webhooks-events\/([^/]+)\/resend$/.exec(url)?.[1];
    if (resend) {
      if (resendRefusals-- > 0) return send(404, { name: 'RESOURCE_NOT_FOUND' });
      notify(events.get(resend)!.type, events.get(resend)!.resource, resend);
      return send(202, { id: resend });
    }
    return send(404, { name: 'RESOURCE_NOT_FOUND' });
  });
  return { server, calls, verifyBodies };
}

/** A shop's webhook handler: asks the twin to verify each notice, with its own webhook id, the way the SDK does. */
function fakeApp(twinUrl: () => string, opts: { verify?: boolean; status?: number } = {}) {
  const received: { raw: string; headers: Record<string, unknown> }[] = [];
  const server = createServer(async (req, res) => {
    const raw = await readBody(req);
    received.push({ raw, headers: req.headers });
    if (opts.verify !== false) {
      await fetch(`${twinUrl()}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          auth_algo: req.headers['paypal-auth-algo'],
          cert_url: req.headers['paypal-cert-url'],
          transmission_id: req.headers['paypal-transmission-id'],
          transmission_sig: req.headers['paypal-transmission-sig'],
          transmission_time: req.headers['paypal-transmission-time'],
          webhook_id: 'THE-APPS-OWN-ID',
          webhook_event: JSON.parse(raw),
        }),
      });
    }
    res.writeHead(opts.status ?? 200).end();
  });
  return { server, received };
}

describe('RealSession', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0)) await fn();
  });

  async function setUp(sandboxOpts: Parameters<typeof fakeSandbox>[0] = {}, appOpts: Parameters<typeof fakeApp>[1] = {}, waitMs = 2000, decision: CustomerDecision = { action: 'update_card' }, by: DecisionBy = 'model') {
    const sandbox = fakeSandbox(sandboxOpts);
    const sandboxUrl = await listen(sandbox.server);
    let twin: Twin | undefined;
    const app = fakeApp(() => twin!.url, appOpts);
    const asked: DecisionContext[] = [];
    const appUrl = await listen(app.server);
    // The sandbox posts straight to the receiver in place of a tunnel, so the public address is the receiver itself.
    const session: RealSession = new RealSession({
      creds: { clientId: 'id', clientSecret: 'secret' },
      appWebhookUrl: appUrl,
      publicUrl: 'http://127.0.0.1:47811',
      receiverPort: 47811,
      sandboxBase: sandboxUrl,
      waitMs,
      customer: leo,
      decide: async (ctx) => {
        asked.push(ctx);
        return { decision, by };
      },
    });
    twin = await createTwin({ port: 0, real: session, upstreamBase: sandboxUrl });
    cleanups.push(() => close(sandbox.server), () => close(app.server), () => twin!.close());
    return { sandbox, app, session, twin, asked };
  }

  it('runs a real subscription and has real PayPal verify every real notice', async () => {
    const { session, sandbox, app } = await setUp();
    const report = await session.run();

    expect(report.error).toBeUndefined();
    expect(report.subscriptionId).toBe('I-REAL');
    expect(report.actions.map((a) => a.name)).toEqual(['create product', 'create plan', 'create subscription', 'suspend', 'activate', 'cancel (end of run)', 'resend a notice']);
    for (const action of report.actions.filter((a) => a.expects)) expect(action.noticeSeconds).toBeTypeOf('number');
    expect(report.notices.map((n) => n.eventType)).toEqual([
      'BILLING.SUBSCRIPTION.ACTIVATED',
      'BILLING.SUBSCRIPTION.SUSPENDED',
      'BILLING.SUBSCRIPTION.ACTIVATED',
      'BILLING.SUBSCRIPTION.CANCELLED',
      'BILLING.SUBSCRIPTION.ACTIVATED',
    ]);
    expect(report.notices.every((n) => n.verify === 'SUCCESS' && n.appStatus === 200)).toBe(true);
    // The app's own webhook id could never match, so ours replaced it on the way to PayPal.
    expect(sandbox.verifyBodies.every((b) => b.webhook_id === 'REAL-WEBHOOK-ID')).toBe(true);
    expect(sandbox.verifyBodies).toHaveLength(5);
    expect(app.received[0]!.headers['paypal-transmission-sig']).toBe('c2ln');
  });

  it('asks the customer only after the suspension, in character', async () => {
    const { session, asked, sandbox } = await setUp();
    const report = await session.run();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ key: 'Leo:payment_failed:1', customer: leo, point: 'payment_failed' });
    expect(report.decision).toEqual({ customer: 'Leo', decision: { action: 'update_card' }, by: 'model' });
    const urls = sandbox.calls.map((c) => c.url);
    expect(urls.findIndex((u) => u.endsWith('/suspend'))).toBeLessThan(urls.findIndex((u) => u.endsWith('/activate')));
  });

  it('a customer who cancels cancels on real PayPal, and nothing reactivates', async () => {
    const { session, sandbox } = await setUp({}, {}, 2000, { action: 'cancel' });
    const report = await session.run();
    expect(report.actions.map((a) => a.name)).toEqual(['create product', 'create plan', 'create subscription', 'suspend', 'cancel', 'resend a notice']);
    expect(sandbox.calls.some((c) => c.url.endsWith('/activate'))).toBe(false);
    expect(sandbox.calls.filter((c) => c.url.endsWith('/cancel'))).toHaveLength(1);
  });

  it('a customer who ignores it stays suspended until the run ends', async () => {
    const { session, sandbox } = await setUp({}, {}, 2000, { action: 'ignore' });
    const report = await session.run();
    expect(report.actions.map((a) => a.name)).toEqual(['create product', 'create plan', 'create subscription', 'suspend', 'cancel (end of run)', 'resend a notice']);
    expect(sandbox.calls.some((c) => c.url.endsWith('/activate'))).toBe(false);
  });

  it('a dispute is reported but never played on real PayPal', async () => {
    const { session, sandbox } = await setUp({}, {}, 2000, { action: 'dispute', reason: 'OTHER', message: 'No.' });
    const report = await session.run();
    expect(report.decision?.decision.action).toBe('dispute');
    expect(report.actions.map((a) => a.name)).toContain('cancel (end of run)');
    expect(sandbox.calls.some((c) => c.url.includes('dispute'))).toBe(false);
  });

  it('says when the scripted default decided, not Claude', async () => {
    const { session } = await setUp({}, {}, 2000, { action: 'ignore' }, 'scripted');
    const report = await session.run();
    expect(report.decision?.by).toBe('scripted');
  });

  it('marks the resent notice as a duplicate', async () => {
    const { session } = await setUp();
    const report = await session.run();
    expect(report.notices.filter((n) => n.duplicate)).toHaveLength(1);
    expect(report.notices.at(-1)!.eventId).toBe(report.notices[0]!.eventId);
  });

  it('forwards the notice byte for byte', async () => {
    const { session, app } = await setUp();
    await session.run();
    expect(JSON.parse(app.received[0]!.raw)).toMatchObject({ event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-REAL' } });
    expect(app.received[0]!.raw).toBe(JSON.stringify(JSON.parse(app.received[0]!.raw)));
  });

  it('says not-asked when the app never checks the signature, and passes on what the app answered', async () => {
    const { session, sandbox } = await setUp({}, { verify: false, status: 500 });
    const report = await session.run();
    expect(report.notices.length).toBeGreaterThan(0);
    expect(report.notices.every((n) => n.verify === 'not-asked' && n.appStatus === 500)).toBe(true);
    expect(sandbox.verifyBodies).toHaveLength(0);
  });

  it('never fakes a notice that did not arrive', async () => {
    const { session } = await setUp({ silent: 'BILLING.SUBSCRIPTION.SUSPENDED' }, {}, 100);
    const report = await session.run();
    const suspend = report.actions.find((a) => a.name === 'suspend')!;
    expect(suspend.expects).toBe('BILLING.SUBSCRIPTION.SUSPENDED');
    expect(suspend.noticeSeconds).toBeUndefined();
    expect(report.notices.some((n) => n.eventType === 'BILLING.SUBSCRIPTION.SUSPENDED')).toBe(false);
  });

  it('removes the webhook and reports the error when the sandbox refuses a step', async () => {
    const { session, sandbox } = await setUp({ rejectAt: '/suspend' });
    const report = await session.run();
    expect(report.error).toContain('suspend');
    expect(sandbox.calls.some((c) => c.method === 'DELETE' && c.url === '/v1/notifications/webhooks/REAL-WEBHOOK-ID')).toBe(true);
  });

  it('keeps the result when PayPal keeps refusing the resend, and says no duplicate was tested', async () => {
    const { session, sandbox } = await setUp({ rejectAt: '/resend' }, {}, 300);
    const report = await session.run();
    expect(report.error).toBeUndefined();
    expect(report.resend).toBe('refused');
    expect(report.notices.filter((n) => n.duplicate)).toHaveLength(0);
    expect(sandbox.calls.filter((c) => c.url.endsWith('/resend'))).toHaveLength(6);
    expect(sandbox.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });

  it('asks again when the resend is refused at first', async () => {
    const { session } = await setUp({ refuseResendTimes: 2 }, {}, 600);
    const report = await session.run();
    expect(report.resend).toBe('arrived');
    expect(report.notices.filter((n) => n.duplicate)).toHaveLength(1);
  });

  it('refuses a sandbox base that is live PayPal', () => {
    expect(() => new RealSession({ creds: { clientId: 'a', clientSecret: 'b' }, appWebhookUrl: 'http://127.0.0.1:1', publicUrl: 'https://x.example', sandboxBase: 'https://api-m.paypal.com', customer: leo, decide: async () => ({ action: 'ignore' }) })).toThrow(/refusing/);
  });

  it("sends the app's subscription lookup to real PayPal, using the session's own token", async () => {
    const { twin, sandbox } = await setUp();
    const res = await fetch(`${twin.url}/v1/billing/subscriptions/I-REAL`, { headers: { authorization: 'Bearer FF-APP-TOKEN' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'I-REAL', status: 'ACTIVE' });
    expect(sandbox.calls.some((c) => c.method === 'GET' && c.url === '/v1/billing/subscriptions/I-REAL')).toBe(true);
  });

  it('leaves simulated runs to the twin even with a real session present', async () => {
    const { twin, sandbox } = await setUp();
    const shop = new FakeApp({ twinUrl: twin.url });
    await shop.start();
    cleanups.push(() => shop.close());
    const scenario: Scenario = {
      name: 'simulated',
      seed: 1,
      start: '2026-11-01T00:00:00.000Z',
      durationDays: 40,
      app: { webhookUrl: shop.webhookUrl, webhookId: 'WH-FF-LOCAL', subscribeUrl: shop.subscribeUrl, probeUrl: shop.probeUrl },
      plan: { name: 'Monthly', price: '12.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
      customers: [{ name: 'Maya', email: 'maya@example.test', persona: '', card: { kind: 'ok' }, actions: [] }],
      weather: { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false },
      expect: { accessWhile: ['ACTIVE'] },
    };
    const created = await fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) });
    expect(created.status, await created.clone().text()).toBe(201);

    const res = await fetch(`${twin.url}/v1/billing/subscriptions/I-REAL`);
    expect(res.status).toBe(404); // the twin's own answer: it has never heard of this subscription
    expect(sandbox.calls.some((c) => c.url.startsWith('/v1/billing'))).toBe(false);
  });

  it('leaves the twin to verify its own notices', async () => {
    const { twin, sandbox } = await setUp();
    const res = await fetch(`${twin.url}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        auth_algo: 'SHA256withRSA',
        cert_url: twin.certUrl,
        transmission_id: '11111111-1111-4111-8111-111111111111',
        transmission_sig: 'c2ln',
        transmission_time: '2026-11-01T02:21:53Z',
        webhook_id: 'WH-FF-LOCAL',
        webhook_event: { id: 'WH-TWIN' },
      }),
    });
    expect(await res.json()).toEqual({ verification_status: 'FAILURE' });
    expect(sandbox.verifyBodies).toHaveLength(0);
  });

  it('serves the real signing certificate to an app that verifies offline', async () => {
    const { twin, session } = await setUp();
    const res = await fetch(`${twin.url}/v1/notifications/certs/CERT-REAL`);
    expect(await res.text()).toBe('REAL-CERT');
    const report = await session.run();
    expect(report.certFetched).toBe(true);
  });
});

describe('pickRealCustomer', () => {
  const maya: Customer = { ...leo, name: 'Maya', card: { kind: 'ok' } };

  it('takes the customer whose card fails', () => {
    expect(pickRealCustomer([maya, leo])?.name).toBe('Leo');
  });

  it('falls back to the first customer', () => {
    expect(pickRealCustomer([maya])?.name).toBe('Maya');
    expect(pickRealCustomer([])).toBeUndefined();
  });
});
