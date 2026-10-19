import type { TraceEntry } from '@fastforward/contracts';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisputeEngine } from '../src/disputes/engine.js';
import { registerDisputeRoutes } from '../src/disputes/routes.js';
import type { DomainEvent } from '../src/subscriptions/events.js';
import { VirtualClock } from '../src/time/clock.js';
import { Scheduler } from '../src/time/scheduler.js';
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

describe('needs the run (Task 9 wiring, after Worker B merges)', () => {
  it.todo('scenario action dispute opens against the latest sale (needs Run: customer actions, SubscriptionEngine.latestSaleId)');
  it.todo('send-message triggers the customer seller_message decision and a reply message on the dispute (needs Run: decide(), then engine.reply())');
});
