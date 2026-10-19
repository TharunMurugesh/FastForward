import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisputeEngine } from '../src/disputes/engine.js';
import { registerDisputeRoutes } from '../src/disputes/routes.js';
import { SubscriptionEngine } from '../src/subscriptions/engine.js';
import { registerSubscriptionRoutes } from '../src/subscriptions/routes.js';
import { VirtualClock } from '../src/time/clock.js';
import { Scheduler } from '../src/time/scheduler.js';
import { registerWebhookRoutes } from '../src/webhooks/routes.js';
import { createSigner } from '../src/webhooks/sign.js';
import { assertMatchesSpec } from './support/openapi.js';

// What the first live fidelity run found the real PayPal sandbox returns (shapes only), reproduced field for field.
vi.setConfig({ testTimeout: 60_000 });

const BILLING = 'billing_subscriptions_v1.json';
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

function harness() {
  const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
  const scheduler = new Scheduler(clock);
  const events: { type: string; resource: Record<string, any> }[] = [];
  const engine = new SubscriptionEngine({ clock, scheduler, emit: (e) => events.push({ type: e.type, resource: e.resource }), cardOutcome: () => 'ok' });
  engine.usePlan({ name: 'Basic', price: '5.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 });
  const app = Fastify();
  apps.push(app);
  registerSubscriptionRoutes(app, () => engine);
  return { clock, scheduler, engine, events, app };
}

const keys = (o: unknown) => Object.keys(o as object).sort();
const inject = async (h: ReturnType<typeof harness>, method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const res = await h.app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });
  return { status: res.statusCode, body: res.body === '' ? undefined : (res.json() as Record<string, any>) };
};

describe('products and plans carry the fields the sandbox adds', () => {
  it('a product has update_time', async () => {
    const h = harness();
    const { status, body } = await inject(h, 'POST', '/v1/catalogs/products', { name: 'Coffee', type: 'SERVICE' });
    expect(status).toBe(201);
    expect(body!.update_time).toBe(body!.create_time);
  });

  it('a plan has usage_type, service_type, setup_fee, pricing scheme times and links with encType', async () => {
    const h = harness();
    h.engine.createProduct({ name: 'Coffee', type: 'SERVICE' });
    const productId = (h.engine.listProducts().products as { id: string }[])[0]!.id;
    const { status, body } = await inject(h, 'POST', '/v1/billing/plans', {
      product_id: productId,
      name: 'Monthly',
      billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: '5.00', currency_code: 'USD' } } }],
      payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
    });
    expect(status).toBe(201);
    expect(body!.usage_type).toBe('LICENSED');
    expect(body!.payment_preferences).toMatchObject({ service_type: 'PREPAID', setup_fee: { currency_code: 'USD', value: '0' }, auto_bill_outstanding: true, payment_failure_threshold: 2 });
    const scheme = body!.billing_cycles[0].pricing_scheme;
    expect(scheme.create_time).toBe(body!.create_time);
    expect(scheme.update_time).toBe(body!.create_time);
    expect(body!.links.every((l: { encType?: string }) => l.encType === 'application/json')).toBe(true);
    assertMatchesSpec(BILLING, '/v1/billing/plans', 'POST', 201, body);
  });
});

describe('a subscription has the fields the sandbox has at each status', () => {
  const PENDING_CREATE = ['create_time', 'custom_id', 'id', 'links', 'plan_id', 'plan_overridden', 'quantity', 'start_time', 'status', 'status_update_time', 'subscriber'];

  it('on create (APPROVAL_PENDING): no billing_info, plan, shipping_amount or update_time; subscriber echoed', async () => {
    const h = harness();
    const { status, body } = await inject(h, 'POST', '/v1/billing/subscriptions', { plan_id: 'P-X', custom_id: 'c' });
    expect(status).toBe(201);
    expect(keys(body)).toEqual(PENDING_CREATE);
    expect(body!.subscriber).toEqual({ tenant: 'paypal' }); // the sandbox adds a tenant when the request has no subscriber
    assertMatchesSpec(BILLING, '/v1/billing/subscriptions', 'POST', 201, body);
  });

  it('on GET while APPROVAL_PENDING: the same, and neither status_update_time nor subscriber', async () => {
    const h = harness();
    const created = (await inject(h, 'POST', '/v1/billing/subscriptions', { plan_id: 'P-X', custom_id: 'c' })).body!;
    const { status, body } = await inject(h, 'GET', `/v1/billing/subscriptions/${created.id}`);
    expect(status).toBe(200);
    expect(keys(body)).toEqual(PENDING_CREATE.filter((k) => k !== 'status_update_time' && k !== 'subscriber'));
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${created.id}`, 'GET', 200, body);
  });

  it('once active: billing_info, update_time and status_update_time appear; plan and shipping_amount still do not', async () => {
    const h = harness();
    const created = (await inject(h, 'POST', '/v1/billing/subscriptions', { plan_id: 'P-X', custom_id: 'c' })).body!;
    h.engine.approve(created.id);
    await h.scheduler.advanceTo(h.clock.now());
    const { body } = await inject(h, 'GET', `/v1/billing/subscriptions/${created.id}`);
    expect(keys(body)).toEqual(['billing_info', 'create_time', 'custom_id', 'id', 'links', 'plan_id', 'plan_overridden', 'quantity', 'start_time', 'status', 'status_update_time', 'subscriber', 'update_time']);
    expect(body!.status).toBe('ACTIVE');
    expect(body!.billing_info.last_payment.amount).toEqual({ currency_code: 'USD', value: '5.00' });
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${created.id}`, 'GET', 200, body);
  });

  it('?fields=plan adds the plan', async () => {
    const h = harness();
    const created = (await inject(h, 'POST', '/v1/billing/subscriptions', { plan_id: 'P-X' })).body!;
    h.engine.approve(created.id);
    const withPlan = (await inject(h, 'GET', `/v1/billing/subscriptions/${created.id}?fields=plan`)).body!;
    expect(withPlan.plan).toMatchObject({ name: 'Basic', billing_cycles: expect.any(Array) });
    const without = (await inject(h, 'GET', `/v1/billing/subscriptions/${created.id}?fields=billing_info`)).body!;
    expect(without.plan).toBeUndefined();
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${created.id}`, 'GET', 200, withPlan);
  });

  it('echoes shipping_amount and subscriber when the request has them', async () => {
    const h = harness();
    const { body } = await inject(h, 'POST', '/v1/billing/subscriptions', {
      plan_id: 'P-X',
      shipping_amount: { currency_code: 'USD', value: '1.50' },
      subscriber: { email_address: 'maya@example.test', name: { given_name: 'Maya' } },
    });
    expect(body!.shipping_amount).toEqual({ currency_code: 'USD', value: '1.50' });
    expect(body!.subscriber).toEqual({ email_address: 'maya@example.test', name: { given_name: 'Maya' } });
    assertMatchesSpec(BILLING, '/v1/billing/subscriptions', 'POST', 201, body);
  });

  it('notices keep status_update_time and billing_info after activation, and carry the plan', async () => {
    const h = harness();
    const created = h.engine.createSubscription({ plan_id: 'P-X' }) as { id: string };
    h.engine.approve(created.id);
    await h.scheduler.advanceTo(h.clock.now());
    const [createdNotice, activated] = h.events;
    expect(createdNotice!.resource.status).toBe('APPROVAL_PENDING');
    expect(createdNotice!.resource.billing_info).toBeUndefined();
    expect(activated!.type).toBe('BILLING.SUBSCRIPTION.ACTIVATED');
    expect(activated!.resource).toMatchObject({ status: 'ACTIVE', status_update_time: '2026-11-01T00:00:00.000Z', update_time: '2026-11-01T00:00:00.000Z' });
    expect(activated!.resource.billing_info).toBeDefined();
    expect(activated!.resource.plan).toBeDefined();
  });
});

describe('cancel', () => {
  it('on an APPROVAL_PENDING subscription answers 404 in PayPal error format and changes nothing', async () => {
    const h = harness();
    const created = (await inject(h, 'POST', '/v1/billing/subscriptions', { plan_id: 'P-X' })).body!;
    const { status, body } = await inject(h, 'POST', `/v1/billing/subscriptions/${created.id}/cancel`, { reason: 'x' });
    expect(status).toBe(404);
    expect(keys(body)).toEqual(['debug_id', 'details', 'links', 'message', 'name']);
    expect(body!.name).toBe('RESOURCE_NOT_FOUND');
    // The sandbox's error links carry a method.
    expect(body!.links.every((l: { method?: string }) => l.method === 'GET')).toBe(true);
    expect((await inject(h, 'GET', `/v1/billing/subscriptions/${created.id}`)).body!.status).toBe('APPROVAL_PENDING');
  });

  it('on an active subscription still answers 204; on a cancelled one 422', async () => {
    const h = harness();
    const created = (await inject(h, 'POST', '/v1/billing/subscriptions', { plan_id: 'P-X' })).body!;
    h.engine.approve(created.id);
    expect((await inject(h, 'POST', `/v1/billing/subscriptions/${created.id}/cancel`, { reason: 'x' })).status).toBe(204);
    expect((await inject(h, 'POST', `/v1/billing/subscriptions/${created.id}/cancel`, { reason: 'x' })).status).toBe(422);
  });
});

describe('verify-webhook-signature', () => {
  async function verifyApp() {
    const signer = await createSigner('SHAPETEST');
    const app = Fastify();
    apps.push(app);
    registerWebhookRoutes(app, { signer, ledger: () => null });
    return app;
  }
  const wellFormed = () => ({
    auth_algo: 'SHA256withRSA',
    cert_url: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-FF-SHAPETEST',
    transmission_id: randomUUID(),
    transmission_sig: Buffer.from('not the right signature').toString('base64'),
    transmission_time: '2026-11-01T00:00:00.000Z',
    webhook_id: 'WH-FF-LOCAL',
    webhook_event: { id: 'WH-1', event_type: 'PAYMENT.SALE.COMPLETED', resource: {} },
  });

  it('a malformed body (the suite\'s deliberately invalid one) answers 400 INVALID_REQUEST in PayPal error format', async () => {
    const app = await verifyApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/notifications/verify-webhook-signature',
      payload: {
        auth_algo: 'SHA256withRSA',
        cert_url: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-INVALID',
        transmission_id: 'invalid-transmission-id',
        transmission_sig: 'invalid-signature',
        transmission_time: '2026-01-01T00:00:00Z',
        webhook_id: 'WH-INVALID',
        webhook_event: { id: 'WH-INVALID', event_type: 'PAYMENT.SALE.COMPLETED', resource: {} },
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['debug_id', 'details', 'links', 'message', 'name']);
    expect(body.name).toBe('INVALID_REQUEST');
    expect(body.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['/transmission_id', '/transmission_sig']));
    for (const d of body.details) expect(Object.keys(d).sort()).toEqual(['field', 'issue', 'location', 'value']);
  });

  it('a body with a missing field answers 400 INVALID_REQUEST too', async () => {
    const app = await verifyApp();
    const { webhook_id: _gone, ...rest } = wellFormed();
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/verify-webhook-signature', payload: rest });
    expect(res.statusCode).toBe(400);
    expect(res.json().details.map((d: { field: string }) => d.field)).toEqual(['/webhook_id']);
  });

  it('a well-formed body with a wrong signature still answers 200 FAILURE', async () => {
    const app = await verifyApp();
    const res = await app.inject({ method: 'POST', url: '/v1/notifications/verify-webhook-signature', payload: wellFormed() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ verification_status: 'FAILURE' });
  });
});

describe('disputes list', () => {
  it('always has items, empty when there are no disputes', async () => {
    const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
    const engine = new DisputeEngine({ clock, scheduler: new Scheduler(clock), emit: () => {}, record: () => {} });
    const app = Fastify();
    apps.push(app);
    registerDisputeRoutes(app, () => engine);
    const res = await app.inject({ method: 'GET', url: '/v1/customer/disputes' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(Object.keys(res.json()).sort()).toEqual(['items', 'links']);
  });
});
