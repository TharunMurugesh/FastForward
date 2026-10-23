import type { Scenario } from '@fastforward/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newPayerId } from '../src/subscriptions/card.js';
import { SubscriptionEngine } from '../src/subscriptions/engine.js';
import type { DomainEvent } from '../src/subscriptions/events.js';
import { registerSubscriptionRoutes } from '../src/subscriptions/routes.js';
import { VirtualClock } from '../src/time/clock.js';
import { Scheduler } from '../src/time/scheduler.js';
import { assertMatchesSpec } from './support/openapi.js';

// The first spec check compiles a 300 KB OpenAPI file (about 6 s cold); later checks reuse it.
vi.setConfig({ testTimeout: 60_000 });

/**
 * A subscription created with a card in `subscriber.payment_source.card` is ACTIVE at once, with its first payment
 * taken, and needs no buyer approval. Seen in PayPal's real sandbox on 23 Oct 2026 (docs/approved-subscriptions-findings.md).
 */

const BILLING = 'billing_subscriptions_v1.json';
const PLAN: Scenario['plan'] = { name: 'Coffee Club', price: '5.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 };
const CARD = {
  name: 'Maya Tester',
  number: '4111111111111111',
  expiry: '2030-12',
  security_code: '123',
  billing_address: { address_line_1: '123 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
};
const withCard = (card: Record<string, unknown> = CARD) => ({
  plan_id: 'P-APP-PLAN',
  custom_id: 'maya',
  subscriber: { name: { given_name: 'Maya', surname: 'Tester' }, email_address: 'maya@example.test', payment_source: { card } },
  application_context: { return_url: 'https://example.com/return', cancel_url: 'https://example.com/cancel' },
});

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

function harness(opts: { cardFails?: boolean } = {}) {
  const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
  const scheduler = new Scheduler(clock);
  const events: DomainEvent[] = [];
  const engine = new SubscriptionEngine({
    clock,
    scheduler,
    emit: (event) => events.push(event),
    cardOutcome: () => (opts.cardFails ? 'fail' : 'ok'),
  });
  engine.usePlan(PLAN);
  const app = Fastify();
  apps.push(app);
  registerSubscriptionRoutes(app, () => engine);
  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/v1/billing/subscriptions', payload: payload as object });
  const types = () => events.map((e) => e.type);
  return { clock, scheduler, engine, events, app, post, types };
}

describe('payer ids', () => {
  it('always match the pattern in the PayPal spec (no 0, 1, I or O), over many ids', () => {
    for (let i = 0; i < 2000; i += 1) expect(newPayerId()).toMatch(/^[2-9A-HJ-NP-Z]{13}$/);
  });
});

describe('a subscription created with a card', () => {
  it('answers 201 ACTIVE with only status, id, create_time and links, and no approve link', async () => {
    const h = harness();
    const res = await h.post(withCard());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('ACTIVE');
    expect(Object.keys(body).sort()).toEqual(['create_time', 'id', 'links', 'status']);
    expect(body.links.some((l: { rel: string }) => l.rel === 'approve')).toBe(false);
    expect(body.id).toMatch(/^I-[A-Z0-9]{12}$/);
    assertMatchesSpec(BILLING, '/v1/billing/subscriptions', 'POST', 201, body);
  });

  it('is ACTIVE with its first payment already taken, before any time passes', async () => {
    const h = harness();
    const { id } = (await h.post(withCard())).json();
    expect(h.types()).toEqual(['BILLING.SUBSCRIPTION.CREATED', 'BILLING.SUBSCRIPTION.ACTIVATED', 'PAYMENT.SALE.COMPLETED']);
    expect(h.engine.completedPayments(id)).toBe(1);
    const got = h.engine.get(id) as Record<string, any>;
    expect(got.status).toBe('ACTIVE');
    expect(got.billing_info.last_payment.amount).toEqual({ currency_code: 'USD', value: '5.00' });
    expect(got.billing_info.cycle_executions[0].cycles_completed).toBe(1);
    expect(got.billing_info.next_billing_time).toBe('2026-12-01T00:00:00.000Z');
    assertMatchesSpec(BILLING, '/v1/billing/subscriptions/{id}', 'GET', 200, got);
  });

  it('keeps billing: the next month is charged when the clock gets there', async () => {
    const h = harness();
    const { id } = (await h.post(withCard())).json();
    await h.scheduler.advanceTo(new Date('2026-12-01T00:00:00.000Z'));
    expect(h.engine.completedPayments(id)).toBe(2);
  });

  it('returns the card as PayPal does: brand, last digits, expiry, name, billing address', async () => {
    const h = harness();
    const { id } = (await h.post(withCard())).json();
    const card = ((h.engine.get(id) as Record<string, any>).subscriber.payment_source as Record<string, any>).card;
    expect(card).toMatchObject({ brand: 'VISA', last_digits: '1111', expiry: '2030-12', name: 'Maya Tester' });
    expect(card.billing_address).toMatchObject({ country_code: 'US', postal_code: '95131' });
  });

  it('never gives back the card number or security code, in any response or webhook event', async () => {
    const h = harness();
    const created = await h.post(withCard());
    const { id } = created.json();
    const everything = JSON.stringify([created.json(), h.engine.get(id), h.engine.get(id, { includePlan: true }), h.engine.transactions(id), h.events]);
    expect(everything).not.toContain('4111111111111111');
    expect(everything).not.toContain('security_code');
    expect(everything).not.toContain('"number"');
  });

  it.each([
    ['4111111111111111', 'VISA'],
    ['5555555555554444', 'MASTERCARD'],
    ['378282246310005', 'AMEX'],
  ])('recognises the brand of %s as %s', async (number, brand) => {
    const h = harness();
    const { id } = (await h.post(withCard({ ...CARD, number }))).json();
    const card = ((h.engine.get(id) as Record<string, any>).subscriber.payment_source as Record<string, any>).card;
    expect(card.brand).toBe(brand);
    expect(card.last_digits).toBe(number.slice(-4));
  });

  it('with a start_time in the future is ACTIVE but takes no payment until then', async () => {
    const h = harness();
    const { id } = (await h.post({ ...withCard(), start_time: '2026-11-10T00:00:00.000Z' })).json();
    expect(h.engine.get(id).status).toBe('ACTIVE');
    expect(h.engine.completedPayments(id)).toBe(0);
    await h.scheduler.advanceTo(new Date('2026-11-10T00:00:00.000Z'));
    expect(h.engine.completedPayments(id)).toBe(1);
  });

  it('when the card is declined at once, stays ACTIVE and reports the failed payment (the normal retry path)', async () => {
    const h = harness({ cardFails: true });
    const { id } = (await h.post(withCard())).json();
    expect(h.types()).toContain('BILLING.SUBSCRIPTION.PAYMENT.FAILED');
    expect(h.engine.completedPayments(id)).toBe(0);
    expect(h.engine.get(id).status).toBe('ACTIVE');
  });

  it('can be suspended, reactivated and cancelled like any active subscription', async () => {
    const h = harness();
    const { id } = (await h.post(withCard())).json();
    h.engine.suspend(id);
    expect(h.engine.get(id).status).toBe('SUSPENDED');
    h.engine.activate(id);
    expect(h.engine.get(id).status).toBe('ACTIVE');
    h.engine.cancel(id, 'done');
    expect(h.engine.get(id).status).toBe('CANCELLED');
  });

  it('rejects a card whose number is not 13 to 19 digits, naming the field', async () => {
    const h = harness();
    const res = await h.post(withCard({ ...CARD, number: '1234' }));
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain('/subscriber/payment_source/card/number');
    expect(h.events).toEqual([]);
  });

  it('answers with the fuller resource when the request asks for the representation (Prefer: return=representation)', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'POST', url: '/v1/billing/subscriptions', headers: { prefer: 'return=representation' }, payload: withCard() });
    const body = res.json();
    expect(res.statusCode).toBe(201);
    expect(Object.keys(body).sort()).toEqual(['create_time', 'id', 'links', 'plan_id', 'plan_overridden', 'quantity', 'start_time', 'status', 'status_update_time', 'subscriber']);
    expect(body.subscriber.payment_source.card.last_digits).toBe('1111');
    // At creation the buyer's name is echoed and there is no payer_id yet; a later GET has the payer_id and no name.
    expect(body.subscriber.name).toEqual({ given_name: 'Maya', surname: 'Tester' });
    expect(body.subscriber.payer_id).toBeUndefined();
    const later = (h.engine.get(body.id) as Record<string, any>).subscriber;
    expect(later.payer_id).toMatch(/^[2-9A-HJ-NP-Z]{13}$/);
    expect(later.name).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('4111111111111111');
    assertMatchesSpec(BILLING, '/v1/billing/subscriptions', 'POST', 201, body);
  });

  it('GET of an active subscription carries what the real sandbox always sends', async () => {
    const h = harness();
    const { id } = (await h.post(withCard())).json();
    const got = h.engine.get(id) as Record<string, any>;
    expect(got.billing_info.current_cycle_sequence).toBe(1);
    expect(got.billing_info.cycle_executions[0]).toMatchObject({ current_pricing_scheme_version: 1, cycles_remaining: 0, total_cycles: 0 });
    expect(got.shipping_amount).toEqual({ currency_code: 'USD', value: '0.00' });
  });

  it('a request without a card is unchanged: APPROVAL_PENDING with an approve link', async () => {
    const h = harness();
    const res = await h.post({ plan_id: 'P-APP-PLAN', custom_id: 'maya' });
    expect(res.json().status).toBe('APPROVAL_PENDING');
    expect(res.json().links.some((l: { rel: string }) => l.rel === 'approve')).toBe(true);
    expect(h.types()).toEqual(['BILLING.SUBSCRIPTION.CREATED']);
  });
});
