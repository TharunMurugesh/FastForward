import type { Customer, CustomerDecision, Scenario, TraceEntry } from '@fastforward/contracts';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runChecks } from '../src/checks/index.js';
import { createTwin, type DecisionContext, type Twin } from '../src/index.js';
import { DisputeEngine } from '../src/disputes/engine.js';
import { registerDisputeRoutes } from '../src/disputes/routes.js';
import type { DomainEvent } from '../src/subscriptions/events.js';
import { VirtualClock } from '../src/time/clock.js';
import { Scheduler } from '../src/time/scheduler.js';
import { FakeApp } from './support/fake-app.js';
import { assertMatchesSpec } from './support/openapi.js';

// Compiling the 445 KB dispute spec takes several seconds the first time.
vi.setConfig({ testTimeout: 60_000 });

const SPEC = 'customer_disputes_v1.json';
const d = (iso: string) => new Date(iso);
const day = (iso: string) => iso.slice(0, 10);
const amount = { currency_code: 'USD', value: '5.00' };

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()!.close();
});

function harness() {
  const clock = new VirtualClock('2026-11-20T00:00:00.000Z');
  const scheduler = new Scheduler(clock);
  const events: { type: DomainEvent['type']; at: string; event: DomainEvent }[] = [];
  const trace: TraceEntry[] = [];
  const sellerMessages: { id: string; message: string }[] = [];
  const engine = new DisputeEngine({
    clock,
    scheduler,
    emit: (event) => events.push({ type: event.type, at: clock.now().toISOString(), event }),
    record: (t) => trace.push(t),
    onSellerMessage: (id, message) => sellerMessages.push({ id, message }),
  });
  const app = Fastify();
  apps.push(app);
  registerDisputeRoutes(app, () => engine);
  const open = (message = 'I never received my coffee') =>
    engine.open('I-SUB000000001', 'SALE0000000000001', amount, 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', message);
  const trail = () => events.map((e) => `${day(e.at)} ${e.type}`);
  return { clock, scheduler, engine, app, events, trace, sellerMessages, open, trail };
}

describe('open', () => {
  it('open sets WAITING_FOR_SELLER_RESPONSE, INQUIRY, due date +20 days, emits CREATED', async () => {
    const h = harness();
    const id = h.open();
    expect(id).toMatch(/^PP-D-\d{5}$/);

    const dispute = h.engine.get(id);
    expect(dispute).toMatchObject({
      dispute_id: id,
      status: 'WAITING_FOR_SELLER_RESPONSE',
      dispute_life_cycle_stage: 'INQUIRY',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      dispute_amount: amount,
      create_time: '2026-11-20T00:00:00.000Z',
      seller_response_due_date: '2026-12-10T00:00:00.000Z',
    });
    expect(dispute.disputed_transactions).toEqual([
      expect.objectContaining({ seller_transaction_id: 'SALE0000000000001', gross_amount: amount, transaction_status: 'COMPLETED', custom: 'I-SUB000000001' }),
    ]);
    expect(dispute.messages).toEqual([{ posted_by: 'BUYER', time_posted: '2026-11-20T00:00:00.000Z', content: 'I never received my coffee' }]);

    expect(h.events).toHaveLength(1);
    const created = h.events[0]!.event;
    expect(created.type).toBe('CUSTOMER.DISPUTE.CREATED');
    expect(created.resourceType).toBe('dispute');
    expect(created.resource).toMatchObject({ dispute_id: id, seller_response_due_date: '2026-12-10T00:00:00.000Z' });

    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id}`, 'GET', 200, dispute);
    const res = await h.app.inject({ method: 'GET', url: `/v1/customer/disputes/${id}` });
    expect(res.statusCode).toBe(200);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id}`, 'GET', 200, res.json());
  });

  it('list returns summaries that match the spec', async () => {
    const h = harness();
    const empty = await h.app.inject({ method: 'GET', url: '/v1/customer/disputes' });
    assertMatchesSpec(SPEC, '/v1/customer/disputes', 'GET', 200, empty.json());
    const a = h.open();
    const b = h.open('again');
    const res = await h.app.inject({ method: 'GET', url: '/v1/customer/disputes' });
    const body = res.json();
    assertMatchesSpec(SPEC, '/v1/customer/disputes', 'GET', 200, body);
    expect(body.items.map((i: { dispute_id: string }) => i.dispute_id)).toEqual([a, b]);
    expect(h.engine.list().map((x) => x.dispute_id)).toEqual([a, b]);
  });

  it('unknown dispute answers 404 in PayPal error format', async () => {
    const h = harness();
    const res = await h.app.inject({ method: 'GET', url: '/v1/customer/disputes/PP-D-00000' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ name: 'RESOURCE_NOT_FOUND', debug_id: expect.any(String) });
  });
});

describe('seller actions', () => {
  it('seller action emits UPDATED and records dispute_action', async () => {
    const h = harness();
    const id = h.open();
    h.clock.set(d('2026-11-25T00:00:00.000Z'));
    h.engine.act(id, 'provide-evidence', {
      evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'UPS', tracking_number: '1Z999AA10123456784' }] } }],
    });
    expect(h.trail()).toEqual(['2026-11-20 CUSTOMER.DISPUTE.CREATED', '2026-11-25 CUSTOMER.DISPUTE.UPDATED']);
    expect(h.trace).toEqual([{ at: '2026-11-25T00:00:00.000Z', kind: 'dispute_action', disputeId: id, action: 'provide-evidence' }]);
    const dispute = h.engine.get(id);
    expect(dispute.status).toBe('UNDER_REVIEW');
    expect(dispute.update_time).toBe('2026-11-25T00:00:00.000Z');
    expect(dispute.evidences).toEqual([expect.objectContaining({ evidence_type: 'PROOF_OF_FULFILLMENT' })]);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id}`, 'GET', 200, dispute);
    expect(h.events[1]!.event.resource).toMatchObject({ dispute_id: id, status: 'UNDER_REVIEW' });
  });

  it('every action is recorded by name', () => {
    for (const action of ['provide-evidence', 'accept-claim', 'send-message', 'make-offer'] as const) {
      const h = harness();
      const id = h.open();
      h.engine.act(id, action, action === 'send-message' ? { message: 'hello' } : action === 'make-offer' ? { note: 'n', offer_type: 'REFUND', offer_amount: amount } : {});
      expect(h.trace.map((t) => (t.kind === 'dispute_action' ? t.action : t.kind))).toEqual([action]);
    }
  });

  it('accept-claim emits UPDATED then RESOLVED, refunding the buyer', () => {
    const h = harness();
    const id = h.open();
    h.engine.act(id, 'accept-claim', { note: 'sorry' });
    expect(h.events.map((e) => e.type)).toEqual(['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED']);
    expect(h.engine.get(id)).toMatchObject({ status: 'RESOLVED', dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: amount } });
  });

  it('make-offer waits for the buyer and records the offer', () => {
    const h = harness();
    const id = h.open();
    h.engine.act(id, 'make-offer', { note: 'half back?', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '2.50' } });
    const dispute = h.engine.get(id);
    expect(dispute.status).toBe('WAITING_FOR_BUYER_RESPONSE');
    expect(dispute.offer).toMatchObject({ offer_type: 'REFUND', seller_offered_amount: { value: '2.50' }, buyer_requested_amount: amount });
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id}`, 'GET', 200, dispute);
  });

  it('send-message adds a seller message, waits for the buyer, and tells the run so it can ask the customer', () => {
    const h = harness();
    const id = h.open();
    h.engine.act(id, 'send-message', { message: 'Your order shipped on the 15th' });
    expect(h.engine.get(id).status).toBe('WAITING_FOR_BUYER_RESPONSE');
    expect(h.engine.get(id).messages).toEqual([
      expect.objectContaining({ posted_by: 'BUYER' }),
      { posted_by: 'SELLER', time_posted: '2026-11-20T00:00:00.000Z', content: 'Your order shipped on the 15th' },
    ]);
    expect(h.sellerMessages).toEqual([{ id, message: 'Your order shipped on the 15th' }]);
  });

  it('a buyer reply adds a message and hands the dispute back to the seller', () => {
    const h = harness();
    const id = h.open();
    h.engine.act(id, 'send-message', { message: 'shipped' });
    h.clock.set(d('2026-11-22T00:00:00.000Z'));
    h.engine.reply(id, 'I still have not received anything.');
    const dispute = h.engine.get(id);
    expect(dispute.status).toBe('WAITING_FOR_SELLER_RESPONSE');
    expect((dispute.messages as { posted_by: string; content: string }[]).at(-1)).toMatchObject({ posted_by: 'BUYER', content: 'I still have not received anything.' });
    expect(h.events.at(-1)).toMatchObject({ type: 'CUSTOMER.DISPUTE.UPDATED', at: '2026-11-22T00:00:00.000Z' });
    // The buyer's reply is not a seller action.
    expect(h.trace.map((t) => t.kind === 'dispute_action' && t.action)).toEqual(['send-message']);
  });

  it('seller routes accept JSON and multipart/form-data with an input part, and match the spec', async () => {
    const h = harness();
    const id = h.open();
    const boundary = '----ffboundary';
    const multipart = (input: unknown) =>
      [`--${boundary}`, 'Content-Disposition: form-data; name="input"', 'Content-Type: application/json', '', JSON.stringify(input), `--${boundary}`, 'Content-Disposition: form-data; name="file1"; filename="proof.txt"', 'Content-Type: text/plain', '', 'binary-ish { not json', `--${boundary}--`, ''].join('\r\n');

    const message = await h.app.inject({
      method: 'POST',
      url: `/v1/customer/disputes/${id}/send-message`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart({ message: 'On its way' }),
    });
    expect(message.statusCode).toBe(200);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id}/send-message`, 'POST', 200, message.json());
    expect(h.sellerMessages).toEqual([{ id, message: 'On its way' }]);

    const evidence = await h.app.inject({
      method: 'POST',
      url: `/v1/customer/disputes/${id}/provide-evidence`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart({ evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', evidence_info: { tracking_info: [{ carrier_name: 'UPS', tracking_number: '1Z999AA10123456784' }] } }] }),
    });
    expect(evidence.statusCode).toBe(200);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id}/provide-evidence`, 'POST', 200, evidence.json());
    expect(h.engine.get(id).evidences).toHaveLength(1);

    const h2 = harness();
    const id2 = h2.open();
    const offer = await h2.app.inject({
      method: 'POST',
      url: `/v1/customer/disputes/${id2}/make-offer`,
      payload: { note: 'refund half', offer_type: 'REFUND', offer_amount: { currency_code: 'USD', value: '2.50' } },
    });
    expect(offer.statusCode).toBe(200);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id2}/make-offer`, 'POST', 200, offer.json());

    const h3 = harness();
    const id3 = h3.open();
    const accept = await h3.app.inject({ method: 'POST', url: `/v1/customer/disputes/${id3}/accept-claim`, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload: multipart({ note: 'ok' }) });
    expect(accept.statusCode).toBe(200);
    expect(h3.engine.get(id3).status).toBe('RESOLVED');
  });

  it('acting on an unknown dispute answers 404; on a resolved one answers 422', async () => {
    const h = harness();
    const missing = await h.app.inject({ method: 'POST', url: '/v1/customer/disputes/PP-D-00000/accept-claim', payload: {} });
    expect(missing.statusCode).toBe(404);
    const id = h.open();
    h.engine.act(id, 'accept-claim', {});
    const again = await h.app.inject({ method: 'POST', url: `/v1/customer/disputes/${id}/send-message`, payload: { message: 'late' } });
    expect(again.statusCode).toBe(422);
    expect(again.json().name).toBe('UNPROCESSABLE_ENTITY');
  });

  it('send-message without a message answers 422', async () => {
    const h = harness();
    const id = h.open();
    const res = await h.app.inject({ method: 'POST', url: `/v1/customer/disputes/${id}/send-message`, payload: {} });
    expect(res.statusCode).toBe(422);
  });
});

describe('deadline', () => {
  it('no action by due date resolves in buyer favour with RESOLVED', async () => {
    const h = harness();
    const id = h.open();
    await h.scheduler.advanceTo(d('2026-12-09T23:59:59.000Z'));
    expect(h.engine.get(id).status).toBe('WAITING_FOR_SELLER_RESPONSE');
    await h.scheduler.advanceTo(d('2026-12-11T00:00:00.000Z'));
    expect(h.trail()).toEqual(['2026-11-20 CUSTOMER.DISPUTE.CREATED', '2026-12-10 CUSTOMER.DISPUTE.RESOLVED']);
    expect(h.engine.get(id)).toMatchObject({
      status: 'RESOLVED',
      dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: amount },
    });
    expect(h.trace).toEqual([]);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${id}`, 'GET', 200, h.engine.get(id));
  });

  it('an action on the due date itself still counts as answered', async () => {
    const h = harness();
    const id = h.open();
    await h.scheduler.advanceTo(d('2026-12-10T00:00:00.000Z'));
    h.engine.act(id, 'send-message', { message: 'last minute' });
    await h.scheduler.advanceTo(d('2026-12-20T00:00:00.000Z'));
    expect(h.engine.get(id).status).toBe('WAITING_FOR_BUYER_RESPONSE');
    expect(h.events.map((e) => e.type)).not.toContain('CUSTOMER.DISPUTE.RESOLVED');
  });

  it('an action before the due date prevents the automatic resolution', async () => {
    const h = harness();
    const id = h.open();
    h.engine.act(id, 'provide-evidence', { evidences: [] });
    await h.scheduler.advanceTo(d('2027-02-01T00:00:00.000Z'));
    expect(h.engine.get(id).status).toBe('UNDER_REVIEW');
    expect(h.events.map((e) => e.type)).toEqual(['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED']);
  });

  it('a dispute already resolved by accept-claim is not resolved twice', async () => {
    const h = harness();
    const id = h.open();
    h.engine.act(id, 'accept-claim', {});
    await h.scheduler.advanceTo(d('2027-02-01T00:00:00.000Z'));
    expect(h.events.filter((e) => e.type === 'CUSTOMER.DISPUTE.RESOLVED')).toHaveLength(1);
  });
});

describe('in runs', { timeout: 60_000 }, () => {
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (closers.length > 0) await closers.pop()!();
  });

  const json = { 'content-type': 'application/json' };
  const customer = (name: string, extra: Partial<Customer> = {}): Customer => ({ name, email: `${name.toLowerCase()}@example.test`, persona: '', card: { kind: 'ok' }, actions: [], ...extra });
  const buildScenario = (app: FakeApp, customers: Customer[]): Scenario => ({
    name: 'disputes',
    seed: 1,
    start: '2026-11-01T00:00:00.000Z',
    durationDays: 61,
    app: { webhookUrl: app.webhookUrl, webhookId: 'WH-FF-LOCAL', subscribeUrl: app.subscribeUrl, probeUrl: app.probeUrl },
    plan: { name: 'Monthly', price: '12.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
    customers,
    weather: { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false },
    expect: { accessWhile: ['ACTIVE'] },
  });

  async function start(customers: Customer[], decide?: (ctx: DecisionContext) => Promise<CustomerDecision>) {
    const twin: Twin = await createTwin({ port: 0, ...(decide ? { deps: { decide } } : {}) });
    closers.push(() => twin.close());
    const app = new FakeApp({ twinUrl: twin.url });
    await app.start();
    closers.push(() => app.close());
    const scenario = buildScenario(app, customers);
    const res = await fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers: json, body: JSON.stringify({ scenario }) });
    const { runId } = (await res.json()) as { runId: string };
    const run = twin.activeRun()!;
    const post = (path: string, body: unknown = {}) => fetch(`${twin.url}${path}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    return {
      twin,
      run,
      app,
      scenario,
      runId,
      advance: (by: string) => post(`/_ff/runs/${runId}/advance`, { by }),
      finish: () => post(`/_ff/runs/${runId}/finish`),
      seller: (disputeId: string, action: string, body: unknown) => post(`/v1/customer/disputes/${disputeId}/${action}`, body),
      dispute: (id: string) => fetch(`${twin.url}/v1/customer/disputes/${id}`).then((r) => r.json() as Promise<Record<string, any>>),
    };
  }

  const events = (trace: TraceEntry[], type: string) => trace.flatMap((t) => (t.kind === 'event' && t.event.event_type === type ? [t.event] : []));
  const ana = () =>
    customer('Ana', { actions: [{ at: '2026-11-20', do: 'dispute', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', message: 'My first bag never arrived.' }] });

  it('scenario action dispute opens against the latest sale and reaches the app with the real-API fields', async () => {
    const r = await start([ana()]);
    await r.advance('P25D'); // 26 Nov: Ana paid on 1 Nov and disputed on 20 Nov
    const [created] = events(r.run.trace, 'CUSTOMER.DISPUTE.CREATED');
    expect(created).toBeDefined();
    expect(r.app.events.map((e) => e.event_type)).toContain('CUSTOMER.DISPUTE.CREATED');

    const [sale] = events(r.run.trace, 'PAYMENT.SALE.COMPLETED');
    const resource = created!.resource as Record<string, any>;
    expect(resource).toMatchObject({
      dispute_id: expect.stringMatching(/^PP-D-\d{5}$/),
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      status: 'WAITING_FOR_SELLER_RESPONSE',
      seller_response_due_date: '2026-12-10T00:00:00.000Z',
      dispute_amount: { currency_code: 'USD', value: '12.00' },
    });
    expect(resource.disputed_transactions[0].seller_transaction_id).toBe((sale!.resource as { id: string }).id);
    expect(resource.messages).toEqual([{ posted_by: 'BUYER', time_posted: '2026-11-20T00:00:00.000Z', content: 'My first bag never arrived.' }]);

    const live = await r.dispute(resource.dispute_id);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${resource.dispute_id}`, 'GET', 200, live);
    assertMatchesSpec(SPEC, `/v1/customer/disputes/${resource.dispute_id}`, 'GET', 200, resource);
  });

  it('an unanswered dispute is resolved for the buyer at the deadline, and DISPUTE_ANSWERED fails', async () => {
    const r = await start([ana()]);
    await r.finish();
    const [resolved] = events(r.run.trace, 'CUSTOMER.DISPUTE.RESOLVED');
    expect(resolved!.resource).toMatchObject({ status: 'RESOLVED', dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR' } });
    expect(r.app.events.map((e) => e.event_type)).toContain('CUSTOMER.DISPUTE.RESOLVED');
    expect(runChecks(r.run.trace, r.scenario).find((c) => c.id === 'DISPUTE_ANSWERED')!.status).toBe('fail');
  });

  it('an answered dispute is not resolved, and DISPUTE_ANSWERED passes', async () => {
    const r = await start([ana()]);
    await r.advance('P21D');
    const id = (events(r.run.trace, 'CUSTOMER.DISPUTE.CREATED')[0]!.resource as { dispute_id: string }).dispute_id;
    const res = await r.seller(id, 'provide-evidence', { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT' }] });
    expect(res.status).toBe(200);
    await r.finish();
    expect(events(r.run.trace, 'CUSTOMER.DISPUTE.RESOLVED')).toEqual([]);
    expect(runChecks(r.run.trace, r.scenario).find((c) => c.id === 'DISPUTE_ANSWERED')!.status).toBe('pass');
  });

  it('send-message triggers the customer seller_message decision and a reply message on the dispute', async () => {
    const asked: DecisionContext[] = [];
    const decide = async (ctx: DecisionContext): Promise<CustomerDecision> => {
      asked.push(ctx);
      return { action: 'reply', message: `Reply number ${asked.length}: still nothing.` };
    };
    const r = await start([ana()], decide);
    await r.advance('P21D');
    const id = (events(r.run.trace, 'CUSTOMER.DISPUTE.CREATED')[0]!.resource as { dispute_id: string }).dispute_id;

    await r.seller(id, 'send-message', { message: 'It shipped with UPS on 15 Nov.' });
    await r.advance('P1D');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ key: 'Ana:seller_message:1', point: 'seller_message' });
    expect(asked[0]!.details).toContain('It shipped with UPS on 15 Nov.');
    let dispute = await r.dispute(id);
    expect(dispute.messages.map((m: { posted_by: string; content: string }) => [m.posted_by, m.content])).toEqual([
      ['BUYER', 'My first bag never arrived.'],
      ['SELLER', 'It shipped with UPS on 15 Nov.'],
      ['BUYER', 'Reply number 1: still nothing.'],
    ]);
    expect(dispute.status).toBe('WAITING_FOR_SELLER_RESPONSE');
    expect(r.run.trace.filter((t) => t.kind === 'customer_decision')).toEqual([
      { at: expect.any(String), kind: 'customer_decision', customer: 'Ana', decision: { action: 'reply', message: 'Reply number 1: still nothing.' } },
    ]);

    await r.seller(id, 'send-message', { message: 'Please check with a neighbour.' });
    await r.advance('P1D');
    expect(asked.map((a) => a.key)).toEqual(['Ana:seller_message:1', 'Ana:seller_message:2']);
    dispute = await r.dispute(id);
    expect(dispute.messages).toHaveLength(5);
  });

  it('a payment_failed decision to dispute opens a dispute against the latest sale', async () => {
    const decide = async (): Promise<CustomerDecision> => ({ action: 'dispute', reason: 'UNAUTHORISED', message: 'I do not recognise this charge.' });
    const r = await start([customer('Leo', { card: { kind: 'fails_from', date: '2026-12-01' } })], decide);
    await r.finish();
    const [created] = events(r.run.trace, 'CUSTOMER.DISPUTE.CREATED');
    expect(created!.resource).toMatchObject({ reason: 'UNAUTHORISED', messages: [{ posted_by: 'BUYER', content: 'I do not recognise this charge.' }] });
  });

  it('a dispute before the customer has paid anything is ignored', async () => {
    const early = customer('Zed', { actions: [{ at: '2026-11-01', do: 'dispute', reason: 'OTHER' }], card: { kind: 'fails_from', date: '2026-11-01' } });
    const r = await start([early]);
    await r.advance('P3D');
    expect(events(r.run.trace, 'CUSTOMER.DISPUTE.CREATED')).toEqual([]);
  });

  it('dispute routes answer 409 in PayPal format when no run is active', async () => {
    const twin = await createTwin({ port: 0 });
    closers.push(() => twin.close());
    const res = await fetch(`${twin.url}/v1/customer/disputes`);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ name: 'NO_ACTIVE_RUN' });
  });
});
