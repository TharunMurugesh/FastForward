import type { Scenario } from '@fastforward/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fidelity } from '../src/fidelity.js';
import { SubscriptionEngine } from '../src/subscriptions/engine.js';
import type { DomainEvent } from '../src/subscriptions/events.js';
import { registerSubscriptionRoutes } from '../src/subscriptions/routes.js';
import { VirtualClock } from '../src/time/clock.js';
import { Scheduler } from '../src/time/scheduler.js';
import { assertMatchesSpec } from './support/openapi.js';

// The first spec check compiles a 300 KB OpenAPI file (about 6 s cold); later checks reuse it.
vi.setConfig({ testTimeout: 60_000 });

const BILLING = 'billing_subscriptions_v1.json';
const CATALOG = 'catalogs_products_v1.json';
const d = (iso: string) => new Date(iso);
const day = (iso: string) => iso.slice(0, 10);

type PlanOpts = Partial<Scenario['plan']>;
const scenarioPlan = (o: PlanOpts = {}): Scenario['plan'] => ({
  name: 'Coffee Club',
  price: '5.00',
  currency: 'USD',
  interval: 'MONTH',
  trialDays: 0,
  totalCycles: 0,
  paymentFailureThreshold: 2,
  ...o,
});

interface Logged {
  type: DomainEvent['type'];
  at: string;
  event: DomainEvent;
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

/** An engine on a virtual clock, a card whose behaviour the test controls, and the routes on a Fastify app. */
function harness(opts: { start?: string; plan?: PlanOpts | null; cardFails?: (at: Date) => boolean } = {}) {
  const clock = new VirtualClock(opts.start ?? '2026-11-01T00:00:00.000Z');
  const scheduler = new Scheduler(clock);
  const events: Logged[] = [];
  const state = { cardFails: opts.cardFails ?? (() => false) };
  const engine = new SubscriptionEngine({
    clock,
    scheduler,
    emit: (event) => events.push({ type: event.type, at: clock.now().toISOString(), event }),
    cardOutcome: (_id, at) => (state.cardFails(at) ? 'fail' : 'ok'),
  });
  if (opts.plan !== null) engine.usePlan(scenarioPlan(opts.plan));
  const app = Fastify();
  apps.push(app);
  registerSubscriptionRoutes(app, () => engine);

  const subscribe = (body: Record<string, unknown> = {}) => {
    const sub = engine.createSubscription({ plan_id: 'P-APP-SANDBOX-PLAN', custom_id: 'maya', ...body }) as { id: string };
    engine.approve(sub.id);
    return sub.id;
  };
  const advanceTo = (iso: string) => scheduler.advanceTo(d(iso));
  const trail = (...types: DomainEvent['type'][]) =>
    events.filter((e) => types.length === 0 || types.includes(e.type)).map((e) => `${day(e.at)} ${e.type}`);
  const billing = (id: string) => (engine.get(id).billing_info as Record<string, any>);
  return { clock, scheduler, engine, events, state, app, subscribe, advanceTo, trail, billing };
}

const SALE = 'PAYMENT.SALE.COMPLETED';

describe('create and approve', () => {
  it('create returns APPROVAL_PENDING with approve link', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/v1/billing/subscriptions', payload: { plan_id: 'P-APP-SANDBOX-PLAN', custom_id: 'maya' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('APPROVAL_PENDING');
    expect(body.plan_id).toBe('P-APP-SANDBOX-PLAN');
    expect(body.id).toMatch(/^I-[A-Z0-9]{12}$/);
    const approve = body.links.find((l: { rel: string }) => l.rel === 'approve');
    expect(approve.href).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\/webapps\/billing\/subscriptions\?ba_token=BA-/);
    assertMatchesSpec(BILLING, '/v1/billing/subscriptions', 'POST', 201, body);
    expect(h.trail()).toEqual(['2026-11-01 BILLING.SUBSCRIPTION.CREATED']);
  });

  it('approve activates, emits CREATED then ACTIVATED then SALE.COMPLETED', async () => {
    const h = harness();
    const id = h.subscribe();
    await h.advanceTo('2026-11-01T00:00:00.000Z');
    expect(h.trail()).toEqual(['2026-11-01 BILLING.SUBSCRIPTION.CREATED', '2026-11-01 BILLING.SUBSCRIPTION.ACTIVATED', `2026-11-01 ${SALE}`]);
    expect(h.engine.get(id).status).toBe('ACTIVE');
    expect(h.engine.completedPayments(id)).toBe(1);
  });

  it('sale resource has the PayPal shape', async () => {
    const h = harness();
    const id = h.subscribe();
    await h.advanceTo('2026-11-01T00:00:00.000Z');
    const sale = h.events.find((e) => e.type === SALE)!.event;
    expect(sale.resourceType).toBe('sale');
    expect(sale.resource).toEqual({
      id: h.engine.latestSaleId(id),
      state: 'completed',
      amount: { total: '5.00', currency: 'USD', details: { subtotal: '5.00' } },
      billing_agreement_id: id,
      create_time: '2026-11-01T00:00:00.000Z',
    });
  });

  it('approving twice, or approving a cancelled subscription, answers 422', async () => {
    const h = harness();
    const id = h.subscribe();
    const again = await h.app.inject({ method: 'POST', url: `/v1/billing/subscriptions/${id}/activate` });
    expect(again.statusCode).toBe(422);
    expect(() => h.engine.approve(id)).toThrow();
  });

  it('unknown subscription answers 404 in PayPal error format', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'GET', url: '/v1/billing/subscriptions/I-NOPE' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ name: 'RESOURCE_NOT_FOUND', message: expect.any(String), debug_id: expect.any(String) });
  });

  it('missing plan_id answers 422', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/v1/billing/subscriptions', payload: { custom_id: 'x' } });
    expect(res.statusCode).toBe(422);
    expect(res.json().details[0].issue).toBe('MISSING_REQUIRED_PARAMETER');
  });
});

describe('billing', () => {
  it('monthly plan bills 3 times in 61 days from 2026-11-01 (11-01, 12-01, 2027-01-01)', async () => {
    const h = harness();
    h.subscribe();
    await h.advanceTo('2027-01-01T00:00:00.000Z');
    expect(h.trail(SALE)).toEqual([`2026-11-01 ${SALE}`, `2026-12-01 ${SALE}`, `2027-01-01 ${SALE}`]);
  });

  it('month-end start 2026-01-31 bills 01-31, 02-28, 03-31', async () => {
    const h = harness({ start: '2026-01-31T00:00:00.000Z' });
    h.subscribe();
    await h.advanceTo('2026-04-15T00:00:00.000Z');
    expect(h.trail(SALE)).toEqual([`2026-01-31 ${SALE}`, `2026-02-28 ${SALE}`, `2026-03-31 ${SALE}`]);
  });

  it('weekly plan bills every 7 days', async () => {
    const h = harness({ plan: { interval: 'WEEK' } });
    h.subscribe();
    await h.advanceTo('2026-11-15T00:00:00.000Z');
    expect(h.trail(SALE)).toEqual([`2026-11-01 ${SALE}`, `2026-11-08 ${SALE}`, `2026-11-15 ${SALE}`]);
  });

  it('trialDays 7 delays the first sale to start + 7 days', async () => {
    const h = harness({ plan: { trialDays: 7 } });
    const id = h.subscribe();
    await h.advanceTo('2026-11-07T23:59:59.000Z');
    expect(h.trail()).toEqual(['2026-11-01 BILLING.SUBSCRIPTION.CREATED', '2026-11-01 BILLING.SUBSCRIPTION.ACTIVATED']);
    expect(h.billing(id).next_billing_time).toBe('2026-11-08T00:00:00.000Z');
    await h.advanceTo('2026-12-08T00:00:00.000Z');
    expect(h.trail(SALE)).toEqual([`2026-11-08 ${SALE}`, `2026-12-08 ${SALE}`]);
    const trial = h.billing(id).cycle_executions[0];
    expect(trial).toMatchObject({ tenure_type: 'TRIAL', cycles_completed: 1 });
  });

  it('totalCycles 2 expires after second payment', async () => {
    const h = harness({ plan: { totalCycles: 2 } });
    const id = h.subscribe();
    await h.advanceTo('2027-03-01T00:00:00.000Z');
    expect(h.trail()).toEqual([
      '2026-11-01 BILLING.SUBSCRIPTION.CREATED',
      '2026-11-01 BILLING.SUBSCRIPTION.ACTIVATED',
      `2026-11-01 ${SALE}`,
      `2026-12-01 ${SALE}`,
      '2026-12-01 BILLING.SUBSCRIPTION.EXPIRED',
    ]);
    expect(h.engine.get(id).status).toBe('EXPIRED');
    expect(h.billing(id).next_billing_time).toBeUndefined();
  });

  it('cancel emits CANCELLED and stops billing', async () => {
    const h = harness();
    const id = h.subscribe();
    await h.advanceTo('2026-11-15T00:00:00.000Z');
    h.engine.cancel(id, 'Customer asked');
    await h.advanceTo('2027-02-01T00:00:00.000Z');
    expect(h.trail()).toEqual([
      '2026-11-01 BILLING.SUBSCRIPTION.CREATED',
      '2026-11-01 BILLING.SUBSCRIPTION.ACTIVATED',
      `2026-11-01 ${SALE}`,
      '2026-11-15 BILLING.SUBSCRIPTION.CANCELLED',
    ]);
    const sub = h.engine.get(id);
    expect(sub.status).toBe('CANCELLED');
    expect(sub.status_change_note).toBe('Customer asked');
  });

  it('suspend stops billing; activate resumes it by charging at once', async () => {
    const h = harness();
    const id = h.subscribe();
    await h.advanceTo('2026-11-10T00:00:00.000Z');
    const suspend = await h.app.inject({ method: 'POST', url: `/v1/billing/subscriptions/${id}/suspend`, payload: { reason: 'Item out of stock' } });
    expect(suspend.statusCode).toBe(204);
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${id}/suspend`, 'POST', 204, suspend.body);
    await h.advanceTo('2026-12-20T00:00:00.000Z');
    expect(h.engine.completedPayments(id)).toBe(1);
    const activate = await h.app.inject({ method: 'POST', url: `/v1/billing/subscriptions/${id}/activate`, payload: { reason: 'Back' } });
    expect(activate.statusCode).toBe(204);
    await h.advanceTo('2026-12-20T00:00:00.000Z');
    expect(h.trail('BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.ACTIVATED', SALE)).toEqual([
      '2026-11-01 BILLING.SUBSCRIPTION.ACTIVATED',
      `2026-11-01 ${SALE}`,
      '2026-11-10 BILLING.SUBSCRIPTION.SUSPENDED',
      '2026-12-20 BILLING.SUBSCRIPTION.ACTIVATED',
      `2026-12-20 ${SALE}`,
    ]);
  });
});

describe('failed payments (docs model, threshold 2, $5.00 monthly, card always declines)', () => {
  // PayPal's retry page: a charge that fails is retried every 5 days, twice. When the second retry fails
  // "PayPal counts this as a payment failure" and the amount is added to the outstanding balance. The
  // next cycle charges price + balance; if that fails and reaches the threshold the subscription is
  // suspended.
  it('failed card emits PAYMENT.FAILED each attempt (11-01, 11-06, 11-11), then on 12-01 fails and suspends', async () => {
    const h = harness({ cardFails: () => true });
    const id = h.subscribe();

    await h.advanceTo('2026-11-05T23:59:59.000Z');
    expect(h.trail()).toEqual([
      '2026-11-01 BILLING.SUBSCRIPTION.CREATED',
      '2026-11-01 BILLING.SUBSCRIPTION.ACTIVATED',
      '2026-11-01 BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    ]);
    expect(h.billing(id)).toMatchObject({ failed_payments_count: 0, outstanding_balance: { value: '0.00' } });
    expect(h.billing(id).last_failed_payment).toMatchObject({ next_payment_retry_time: '2026-11-06T00:00:00.000Z', amount: { value: '5.00' } });

    await h.advanceTo('2026-11-11T00:00:00.000Z');
    expect(h.trail('BILLING.SUBSCRIPTION.PAYMENT.FAILED')).toEqual([
      '2026-11-01 BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      '2026-11-06 BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      '2026-11-11 BILLING.SUBSCRIPTION.PAYMENT.FAILED',
    ]);
    // Retries exhausted: counted once, $5.00 moved to the outstanding balance, no further retry.
    expect(h.billing(id)).toMatchObject({ failed_payments_count: 1, outstanding_balance: { value: '5.00' } });
    expect(h.billing(id).last_failed_payment.next_payment_retry_time).toBeUndefined();
    expect(h.engine.get(id).status).toBe('ACTIVE');

    await h.advanceTo('2027-02-01T00:00:00.000Z');
    expect(h.trail().slice(3)).toEqual([
      '2026-11-06 BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      '2026-11-11 BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      '2026-12-01 BILLING.SUBSCRIPTION.PAYMENT.FAILED',
      '2026-12-01 BILLING.SUBSCRIPTION.SUSPENDED',
    ]);
    // The 12-01 charge was $10.00 (price + balance); the failure reached the threshold, so no retries.
    expect(h.billing(id).last_failed_payment).toMatchObject({ amount: { value: '10.00' }, time: '2026-12-01T00:00:00.000Z' });
    expect(h.billing(id)).toMatchObject({ failed_payments_count: 2, outstanding_balance: { value: '10.00' } });
    expect(h.engine.get(id)).toMatchObject({ status: 'SUSPENDED', status_change_note: 'Reached maximum payment failure threshold' });
    expect(h.engine.completedPayments(id)).toBe(0);
  });

  it('successful retry clears outstanding_balance and resets failed_payments_count (threshold 3)', async () => {
    // Card declines until 3 Dec. 11-01, 11-06, 11-11 fail (count 1, balance $5.00). 12-01 fails and is
    // retried; the 12-06 retry succeeds and charges $10.00 (price + balance).
    const h = harness({ plan: { paymentFailureThreshold: 3 }, cardFails: (at) => at < d('2026-12-03T00:00:00.000Z') });
    const id = h.subscribe();
    await h.advanceTo('2026-12-05T00:00:00.000Z');
    expect(h.billing(id)).toMatchObject({ failed_payments_count: 1, outstanding_balance: { value: '5.00' } });
    expect(h.engine.completedPayments(id)).toBe(0);

    await h.advanceTo('2026-12-06T00:00:00.000Z');
    expect(h.trail(SALE)).toEqual([`2026-12-06 ${SALE}`]);
    const sale = h.events.find((e) => e.type === SALE)!.event.resource as { amount: { total: string } };
    expect(sale.amount.total).toBe('10.00');
    expect(h.billing(id)).toMatchObject({ failed_payments_count: 0, outstanding_balance: { value: '0.00' } });
    expect(h.billing(id).last_failed_payment).toBeUndefined();
    expect(h.engine.get(id).status).toBe('ACTIVE');

    // Billing stays on the 1st: the next charge is the plain price.
    await h.advanceTo('2027-01-01T00:00:00.000Z');
    const sales = h.events.filter((e) => e.type === SALE).map((e) => (e.event.resource as any).amount.total);
    expect(sales).toEqual(['10.00', '5.00']);
    expect(h.trail(SALE).at(-1)).toBe(`2027-01-01 ${SALE}`);
  });

  it('cancel while a retry is queued stops the retry', async () => {
    const h = harness({ cardFails: () => true });
    const id = h.subscribe();
    await h.advanceTo('2026-11-02T00:00:00.000Z');
    h.engine.cancel(id, 'gave up');
    await h.advanceTo('2026-12-30T00:00:00.000Z');
    expect(h.trail('BILLING.SUBSCRIPTION.PAYMENT.FAILED')).toEqual(['2026-11-01 BILLING.SUBSCRIPTION.PAYMENT.FAILED']);
  });

  it('threshold 0 never suspends', async () => {
    const h = harness({ plan: { paymentFailureThreshold: 0 }, cardFails: () => true });
    const id = h.subscribe();
    await h.advanceTo('2027-03-01T00:00:00.000Z');
    expect(h.engine.get(id).status).toBe('ACTIVE');
    expect(h.trail('BILLING.SUBSCRIPTION.SUSPENDED')).toEqual([]);
  });

  it('retry values come from fidelity.ts', () => {
    expect(fidelity.retryIntervalDays).toBe(5);
    expect(fidelity.maxRetries).toBe(2);
  });
});

describe('PayPal shapes (ajv against the official OpenAPI files)', () => {
  it('the checker is not vacuous: a wrong status value and a missing required field are rejected', () => {
    const h = harness();
    const id = h.subscribe();
    const good = h.engine.get(id);
    expect(() => assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${id}`, 'GET', 200, { ...good, status: 'BOGUS' })).toThrow(/status/);
    const bad = { ...good, billing_info: { failed_payments_count: 0 } };
    expect(() => assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${id}`, 'GET', 200, bad)).toThrow(/outstanding_balance/);
  });

  it('GET subscription matches spec schema, active and after a failed payment', async () => {
    const h = harness({ cardFails: (at) => at >= d('2026-12-01T00:00:00.000Z') });
    const id = h.subscribe();
    await h.advanceTo('2026-11-02T00:00:00.000Z');
    let res = await h.app.inject({ method: 'GET', url: `/v1/billing/subscriptions/${id}` });
    expect(res.statusCode).toBe(200);
    let body = res.json();
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${id}`, 'GET', 200, body);
    expect(body.status).toBe('ACTIVE');
    expect(body.billing_info).toMatchObject({
      outstanding_balance: { currency_code: 'USD', value: '0.00' },
      failed_payments_count: 0,
      next_billing_time: '2026-12-01T00:00:00.000Z',
      last_payment: { amount: { value: '5.00' }, time: '2026-11-01T00:00:00.000Z' },
    });
    expect(body.custom_id).toBe('maya');
    expect(body.links.find((l: { rel: string }) => l.rel === 'approve')).toBeUndefined();

    await h.advanceTo('2026-12-02T00:00:00.000Z');
    res = await h.app.inject({ method: 'GET', url: `/v1/billing/subscriptions/${id}` });
    body = res.json();
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${id}`, 'GET', 200, body);
    expect(body.billing_info.last_failed_payment).toMatchObject({ reason_code: 'PAYMENT_DENIED' });
  });

  it('a subscription in every status matches the spec', async () => {
    const h = harness({ plan: { totalCycles: 1 } });
    const pending = h.engine.createSubscription({ plan_id: 'P-X' }) as { id: string };
    const cancelled = h.subscribe();
    h.engine.cancel(cancelled, 'x');
    const expired = h.subscribe();
    const suspended = h.subscribe();
    h.engine.suspend(suspended);
    await h.advanceTo('2026-11-02T00:00:00.000Z');
    for (const id of [pending.id, cancelled, expired, suspended]) {
      assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${id}`, 'GET', 200, h.engine.get(id));
    }
    expect(h.engine.get(expired).status).toBe('EXPIRED');
    expect(h.engine.get(suspended).status).toBe('SUSPENDED');
  });

  it('transactions list matches spec, newest first', async () => {
    const h = harness();
    const id = h.subscribe();
    await h.advanceTo('2026-12-02T00:00:00.000Z');
    const res = await h.app.inject({ method: 'GET', url: `/v1/billing/subscriptions/${id}/transactions?start_time=2026-11-01T00:00:00Z&end_time=2026-12-31T00:00:00Z` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${id}/transactions`, 'GET', 200, body);
    expect(body.transactions.map((t: { time: string }) => day(t.time))).toEqual(['2026-12-01', '2026-11-01']);
    expect(body.transactions[0]).toMatchObject({ status: 'COMPLETED', amount_with_breakdown: { gross_amount: { currency_code: 'USD', value: '5.00' } } });
  });

  it('product and plan create/get/list match spec, and a created plan bills a subscription', async () => {
    const h = harness({ plan: null });
    const product = await h.app.inject({ method: 'POST', url: '/v1/catalogs/products', payload: { name: 'Coffee', type: 'SERVICE', description: 'Beans' } });
    expect(product.statusCode).toBe(201);
    assertMatchesSpec(CATALOG, '/v1/catalogs/products', 'POST', 201, product.json());
    const productId = product.json().id as string;
    expect(productId).toMatch(/^PROD-[A-Z0-9]{17}$/);
    const gotProduct = await h.app.inject({ method: 'GET', url: `/v1/catalogs/products/${productId}` });
    assertMatchesSpec(CATALOG, `/v1/catalogs/products/${productId}`, 'GET', 200, gotProduct.json());
    const products = await h.app.inject({ method: 'GET', url: '/v1/catalogs/products' });
    assertMatchesSpec(CATALOG, '/v1/catalogs/products', 'GET', 200, products.json());
    expect(products.json().products).toHaveLength(1);

    const plan = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/plans',
      payload: {
        product_id: productId,
        name: 'Monthly',
        billing_cycles: [
          { frequency: { interval_unit: 'DAY', interval_count: 3 }, tenure_type: 'TRIAL', sequence: 1, total_cycles: 1 },
          { frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { value: '12.00', currency_code: 'EUR' } } },
        ],
        payment_preferences: { payment_failure_threshold: 2 },
      },
    });
    expect(plan.statusCode).toBe(201);
    assertMatchesSpec(BILLING, '/v1/billing/plans', 'POST', 201, plan.json());
    const planId = plan.json().id as string;
    expect(planId).toMatch(/^P-[A-Z0-9]{24}$/);
    assertMatchesSpec(BILLING, `/v1/billing/plans/${planId}`, 'GET', 200, (await h.app.inject({ method: 'GET', url: `/v1/billing/plans/${planId}` })).json());
    assertMatchesSpec(BILLING, '/v1/billing/plans', 'GET', 200, (await h.app.inject({ method: 'GET', url: '/v1/billing/plans' })).json());

    const created = h.engine.createSubscription({ plan_id: planId }) as { id: string };
    h.engine.approve(created.id);
    await h.advanceTo('2026-12-05T00:00:00.000Z');
    const sale = h.events.filter((e) => e.type === SALE).map((e) => ({ at: day(e.at), amount: (e.event.resource as any).amount }));
    expect(sale).toEqual([
      { at: '2026-11-04', amount: { total: '12.00', currency: 'EUR', details: { subtotal: '12.00' } } },
      { at: '2026-12-04', amount: { total: '12.00', currency: 'EUR', details: { subtotal: '12.00' } } },
    ]);
    assertMatchesSpec(BILLING, `/v1/billing/subscriptions/${created.id}`, 'GET', 200, h.engine.get(created.id));
  });

  it('an unknown plan answers 404 when no scenario plan is set', async () => {
    const h = harness({ plan: null });
    const res = await h.app.inject({ method: 'POST', url: '/v1/billing/subscriptions', payload: { plan_id: 'P-DOESNOTEXIST' } });
    expect(res.statusCode).toBe(404);
  });

  it('a plan for a missing product answers 422', async () => {
    const h = harness({ plan: null });
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/billing/plans',
      payload: { product_id: 'PROD-NOPE', name: 'x', billing_cycles: [{ frequency: { interval_unit: 'MONTH' }, tenure_type: 'REGULAR', sequence: 1 }] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('usePlan bills the scenario plan whatever plan_id the app sends, echoing it back', async () => {
    const h = harness({ plan: { price: '9.99', currency: 'GBP' } });
    const a = h.engine.createSubscription({ plan_id: 'P-ONE' }) as { id: string; plan_id: string };
    const b = h.engine.createSubscription({ plan_id: 'P-TWO' }) as { id: string; plan_id: string };
    expect([a.plan_id, b.plan_id]).toEqual(['P-ONE', 'P-TWO']);
    h.engine.approve(a.id);
    await h.advanceTo('2026-11-01T00:00:00.000Z');
    const sale = h.events.find((e) => e.type === SALE)!.event.resource as { amount: unknown };
    expect(sale.amount).toEqual({ total: '9.99', currency: 'GBP', details: { subtotal: '9.99' } });
  });
});
