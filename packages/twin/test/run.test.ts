import type { Customer, CustomerDecision, Scenario, TraceEntry } from '@fastforward/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createTwin, type DecisionContext, type Twin } from '../src/index.js';
import { FakeApp, type FakeAppOptions } from './support/fake-app.js';

const START = '2026-11-01T00:00:00.000Z';
const json = { 'content-type': 'application/json' };

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanup.length > 0) await cleanup.pop()!();
});

function customer(name: string, extra: Partial<Customer> = {}): Customer {
  return { name, email: `${name.toLowerCase()}@example.test`, persona: '', card: { kind: 'ok' }, actions: [], ...extra };
}

function scenario(app: FakeApp, extra: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test',
    seed: 1,
    start: START,
    durationDays: 61,
    app: { webhookUrl: app.webhookUrl, webhookId: 'WH-FF-LOCAL', subscribeUrl: app.subscribeUrl, probeUrl: app.probeUrl },
    plan: { name: 'Monthly', price: '12.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
    customers: [customer('Maya')],
    weather: { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false },
    expect: { accessWhile: ['ACTIVE'] },
    ...extra,
  };
}

async function setup(opts: Partial<FakeAppOptions> = {}, twinOpts: Parameters<typeof createTwin>[0] = {}): Promise<{ twin: Twin; app: FakeApp }> {
  const twin = await createTwin({ port: 0, ...twinOpts });
  cleanup.push(() => twin.close());
  const app = new FakeApp({ twinUrl: twin.url, ...opts });
  await app.start();
  cleanup.push(() => app.close());
  return { twin, app };
}

async function startRun(twin: Twin, s: Scenario): Promise<Response> {
  return fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers: json, body: JSON.stringify({ scenario: s }) });
}

async function runId(twin: Twin, s: Scenario): Promise<string> {
  const res = await startRun(twin, s);
  const body = (await res.json()) as { runId?: string; error?: string };
  if (res.status !== 201) throw new Error(`run did not start: ${res.status} ${body.error}`);
  return body.runId!;
}

const post = (twin: Twin, path: string, body: unknown = {}) => fetch(`${twin.url}${path}`, { method: 'POST', headers: json, body: JSON.stringify(body) });

type Of<K extends TraceEntry['kind']> = Extract<TraceEntry, { kind: K }>;
const only = <K extends TraceEntry['kind']>(trace: TraceEntry[], kind: K) => trace.filter((t): t is Of<K> => t.kind === kind);

function salesFor(trace: TraceEntry[], subscriptionId: string): string[] {
  return only(trace, 'event')
    .filter((e) => e.event.event_type === 'PAYMENT.SALE.COMPLETED' && e.event.resource.billing_agreement_id === subscriptionId)
    .map((e) => e.at);
}

describe('run start', { timeout: 30_000 }, () => {
  it('start subscribes all customers through subscribeUrl', async () => {
    const { twin, app } = await setup();
    await runId(twin, scenario(app, { customers: [customer('Maya'), customer('Leo'), customer('Ana')] }));
    const run = twin.activeRun()!;
    const subs = run.subscriptions();
    expect(subs.map((s) => s.customer)).toEqual(['Maya', 'Leo', 'Ana']);
    for (const s of subs) expect(s.subscriptionId).toMatch(/^I-[A-Z0-9]{12}$/);

    const creates = only(run.trace, 'app_call').filter((c) => c.method === 'POST' && c.path === '/v1/billing/subscriptions');
    expect(creates.map((c) => c.status)).toEqual([201, 201, 201]);

    // Each customer's first events were delivered at the scenario start, in lifecycle order.
    const maya = subs[0]!.subscriptionId;
    const mayaEvents = only(run.trace, 'event').filter(
      (e) => e.event.resource.id === maya || e.event.resource.billing_agreement_id === maya,
    );
    expect(mayaEvents.map((e) => [e.event.event_type, e.at])).toEqual([
      ['BILLING.SUBSCRIPTION.CREATED', START],
      ['BILLING.SUBSCRIPTION.ACTIVATED', START],
      ['PAYMENT.SALE.COMPLETED', START],
    ]);
    expect(only(run.trace, 'delivery').every((d) => d.status === 200)).toBe(true);
    expect(app.members.get(maya)).toEqual({ access: true, fulfilments: 1 });
  });

  it('aborts with redirect message when app never calls the twin', async () => {
    const { twin, app } = await setup({ redirected: false });
    const res = await startRun(twin, scenario(app));
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("your app isn't redirected");
    expect(error).toContain('FASTFORWARD=1 node --import fastforward-register');
    expect(twin.activeRun()).toBeNull();
  });

  it('tells an app that is aimed at LIVE PayPal so, instead of saying it is not redirected', async () => {
    const { twin, app } = await setup({ redirected: false, blockedLive: true });
    const res = await startRun(twin, scenario(app));
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('LIVE PayPal');
    expect(error).toContain('https://api-m.paypal.com/v1/billing/subscriptions');
    expect(error).toContain('api-m.sandbox.paypal.com');
    expect(error).not.toContain("isn't redirected");
    expect(twin.activeRun()).toBeNull();
  });

  it('still says LIVE PayPal when the add-on reports the blocked call just after the app has already answered', async () => {
    const { twin, app } = await setup({ redirected: false, blockedLive: true, blockedLiveReportDelayMs: 60 });
    const res = await startRun(twin, scenario(app));
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('LIVE PayPal');
    expect(error).not.toContain("isn't redirected");
  });

  it('without subscribeUrl the twin creates subscriptions itself with custom_id = name', async () => {
    const { twin, app } = await setup();
    const s = scenario(app);
    delete s.app.subscribeUrl;
    await runId(twin, s);
    const run = twin.activeRun()!;
    const [maya] = run.subscriptions();
    const sub = (await (await fetch(`${twin.url}/v1/billing/subscriptions/${maya!.subscriptionId}`)).json()) as Record<string, unknown>;
    expect(sub).toMatchObject({ status: 'ACTIVE', custom_id: 'Maya' });
  });

  it('rejects an invalid scenario with every problem listed', async () => {
    const { twin } = await setup();
    const res = await startRun(twin, { name: 'broken', start: 'yesterday' } as unknown as Scenario);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain('start');
    expect(error).toContain('app.webhookUrl');
    expect(error).toContain('customers');
  });

  it('subscription routes answer an error when no run is active', async () => {
    const { twin } = await setup();
    const res = await post(twin, '/v1/billing/subscriptions', { plan_id: 'P-X' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { name: string }).name).toBe('NO_ACTIVE_RUN');
  });
});

describe('running', { timeout: 30_000 }, () => {
  it('runToEnd delivers 3 sales for Maya over 61 days', async () => {
    const { twin, app } = await setup();
    const id = await runId(twin, scenario(app));
    const res = await post(twin, `/_ff/runs/${id}/finish`);
    expect(res.status).toBe(200);
    const trace = (await (await fetch(`${twin.url}/_ff/runs/${id}/trace`)).json()) as TraceEntry[];
    const [maya] = only(trace, 'event').filter((e) => e.event.event_type === 'BILLING.SUBSCRIPTION.CREATED');
    const sales = salesFor(trace, maya!.event.resource.id as string);
    expect(sales).toEqual([START, '2026-12-01T00:00:00.000Z', '2027-01-01T00:00:00.000Z']);
    // The app re-read the subscription through the real subscription routes on every event.
    const reads = only(trace, 'app_call').filter((c) => c.method === 'GET' && c.path.startsWith('/v1/billing/subscriptions/'));
    expect(reads.length).toBe(only(trace, 'event').length);
    expect(reads.every((c) => c.status === 200)).toBe(true);
    // finish released the twin: a new run can start.
    expect(twin.activeRun()).toBeNull();
    expect((await startRun(twin, scenario(app))).status).toBe(201);
  });

  it('probe entries recorded at checkpoints with expectedAccess', async () => {
    const { twin, app } = await setup();
    const id = await runId(twin, scenario(app, { customers: [customer('Maya'), customer('Leo', { card: { kind: 'fails_from', date: '2026-12-01' } })] }));
    await post(twin, `/_ff/runs/${id}/finish`);
    const trace = (await (await fetch(`${twin.url}/_ff/runs/${id}/trace`)).json()) as TraceEntry[];
    const [mayaSub, leoSub] = only(trace, 'event')
      .filter((e) => e.event.event_type === 'BILLING.SUBSCRIPTION.CREATED')
      .map((e) => e.event.resource.id as string);
    const probes = only(trace, 'probe');

    // A checkpoint closes every virtual day that had a delivery, plus one at the end (which also covers
    // deliveries at the end instant itself: the run's last moment is inclusive).
    const end = '2027-01-01T00:00:00.000Z';
    const days = [...new Set(only(trace, 'delivery').map((d) => d.at.slice(0, 10)))];
    const expectedTimes = [...days.map((d) => `${d}T23:59:59.999Z`).filter((t) => t < end), end];
    expect([...new Set(probes.map((p) => p.at))]).toEqual(expectedTimes);

    const leo = probes.filter((p) => p.subscriptionId === leoSub);
    // Leo: card fails 12-01, retried 12-06, suspended at the threshold; access must follow.
    expect(leo.at(-1)).toMatchObject({ access: false, expectedAccess: false, completedPayments: 1, fulfilments: 1 });
    expect(leo[0]).toMatchObject({ access: true, expectedAccess: true });
    const maya = probes.filter((p) => p.subscriptionId === mayaSub);
    expect(maya.at(-1)).toMatchObject({ access: true, expectedAccess: true, completedPayments: 3, fulfilments: 3 });
  });

  it('payment_failed decision update_card makes next retry succeed', async () => {
    const contexts: DecisionContext[] = [];
    const decide = async (ctx: DecisionContext): Promise<CustomerDecision> => {
      contexts.push(ctx);
      return { action: 'update_card' };
    };
    const { twin, app } = await setup({}, { deps: { decide } });
    const id = await runId(twin, scenario(app, { customers: [customer('Leo', { card: { kind: 'fails_from', date: '2026-12-01' } })] }));
    await post(twin, `/_ff/runs/${id}/finish`);
    const trace = (await (await fetch(`${twin.url}/_ff/runs/${id}/trace`)).json()) as TraceEntry[];
    const leoSub = only(trace, 'event').find((e) => e.event.event_type === 'BILLING.SUBSCRIPTION.CREATED')!.event.resource.id as string;

    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({ key: 'Leo:payment_failed:1', point: 'payment_failed', at: '2026-12-01T00:00:00.000Z' });
    expect(contexts[0]!.customer.name).toBe('Leo');
    expect(only(trace, 'customer_decision')).toEqual([
      { at: '2026-12-01T00:00:00.000Z', kind: 'customer_decision', customer: 'Leo', decision: { action: 'update_card' } },
    ]);
    // Retry 5 days later succeeds, and January bills normally.
    expect(salesFor(trace, leoSub)).toEqual([START, '2026-12-06T00:00:00.000Z', '2027-01-01T00:00:00.000Z']);
  });

  it('scheduled customer cancel stops billing', async () => {
    const { twin, app } = await setup();
    const id = await runId(twin, scenario(app, { customers: [customer('Maya', { actions: [{ at: '2026-11-15', do: 'cancel' }] })] }));
    await post(twin, `/_ff/runs/${id}/finish`);
    const trace = (await (await fetch(`${twin.url}/_ff/runs/${id}/trace`)).json()) as TraceEntry[];
    const types = only(trace, 'event').map((e) => [e.event.event_type, e.at]);
    expect(types).toContainEqual(['BILLING.SUBSCRIPTION.CANCELLED', '2026-11-15T00:00:00.000Z']);
    expect(types.filter(([t]) => t === 'PAYMENT.SALE.COMPLETED')).toHaveLength(1);
  });

  it('records verify calls and cert fetches with virtual time', async () => {
    const { twin, app } = await setup();
    const id = await runId(twin, scenario(app));
    const run = twin.activeRun()!;
    const verifies = only(run.trace, 'verify_call');
    expect(verifies).toHaveLength(3);
    expect(verifies.every((v) => v.result === 'SUCCESS' && v.at === START)).toBe(true);
    expect(verifies.map((v) => v.transmissionId)).toEqual(only(run.trace, 'delivery').map((d) => d.transmissionId));

    // A cert fetch later in the run carries that virtual time.
    await post(twin, `/_ff/runs/${id}/advance`, { by: 'P3D' });
    expect((await fetch(twin.certUrl.replace('https://api.sandbox.paypal.com', twin.url))).status).toBe(200);
    expect(only(run.trace, 'cert_fetch')).toEqual([{ at: '2026-11-04T00:00:00.000Z', kind: 'cert_fetch' }]);
  });
});

describe('control API', { timeout: 30_000 }, () => {
  it('advance moves virtual time by P<n>D or to an instant, and GET shows the run', async () => {
    const { twin, app } = await setup();
    const id = await runId(twin, scenario(app));
    expect((await post(twin, `/_ff/runs/${id}/advance`, { by: 'P10D' })).status).toBe(200);
    let info = (await (await fetch(`${twin.url}/_ff/runs/${id}`)).json()) as { runId: string; now: string; end: string; subscriptions: unknown[] };
    expect(info).toMatchObject({ runId: id, now: '2026-11-11T00:00:00.000Z', end: '2027-01-01T00:00:00.000Z' });
    expect(info.subscriptions).toHaveLength(1);

    expect((await post(twin, `/_ff/runs/${id}/advance`, { to: '2026-12-01T12:00:00.000Z' })).status).toBe(200);
    info = (await (await fetch(`${twin.url}/_ff/runs/${id}`)).json()) as typeof info;
    expect(info.now).toBe('2026-12-01T12:00:00.000Z');

    // Past the end clamps to the end.
    await post(twin, `/_ff/runs/${id}/advance`, { by: 'P999D' });
    info = (await (await fetch(`${twin.url}/_ff/runs/${id}`)).json()) as typeof info;
    expect(info.now).toBe('2027-01-01T00:00:00.000Z');
  });

  it('advance rejects bad bodies, backwards moves and unknown runs', async () => {
    const { twin, app } = await setup();
    const id = await runId(twin, scenario(app));
    expect((await post(twin, `/_ff/runs/${id}/advance`, {})).status).toBe(400);
    expect((await post(twin, `/_ff/runs/${id}/advance`, { by: '10 days' })).status).toBe(400);
    expect((await post(twin, `/_ff/runs/${id}/advance`, { to: '2026-10-01T00:00:00.000Z' })).status).toBe(400);
    expect((await post(twin, '/_ff/runs/run-nope/advance', { by: 'P1D' })).status).toBe(404);
    expect((await fetch(`${twin.url}/_ff/runs/run-nope`)).status).toBe(404);
  });

  it('stream emits trace entries', async () => {
    const { twin, app } = await setup();
    const id = await runId(twin, scenario(app));
    const res = await fetch(`${twin.url}/_ff/runs/${id}/stream`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const advancing = post(twin, `/_ff/runs/${id}/advance`, { by: 'P31D' });
    // Read until the December sale shows up live (the backlog comes first).
    while (!text.includes('"2026-12-01T00:00:00.000Z"') || !text.includes('PAYMENT.SALE.COMPLETED')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    await advancing;
    await reader.cancel();
    const entries = text
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as TraceEntry);
    expect(entries[0]).toMatchObject({ kind: 'app_call' });
    expect(entries.some((e) => e.kind === 'event' && e.at === '2026-12-01T00:00:00.000Z')).toBe(true);
  });
});

describe('scale', () => {
  it('200 customers × 365 days completes under 60 s', { timeout: 120_000 }, async () => {
    const before = process.env.FF_DELIVERY_TIMEOUT_MS;
    process.env.FF_DELIVERY_TIMEOUT_MS = '500';
    try {
      const { twin, app } = await setup();
      const customers = Array.from({ length: 200 }, (_, i) => customer(`C${i}`));
      const started = performance.now();
      const id = await runId(twin, scenario(app, { durationDays: 365, customers }));
      const res = await post(twin, `/_ff/runs/${id}/finish`);
      const seconds = (performance.now() - started) / 1000;
      expect(res.status).toBe(200);
      const trace = (await (await fetch(`${twin.url}/_ff/runs/${id}/trace`)).json()) as TraceEntry[];
      const deliveries = only(trace, 'delivery');
      console.log(
        `scale: 200 customers x 365 days in ${seconds.toFixed(1)} s; ${only(trace, 'event').length} events, ${deliveries.length} deliveries (mean ${(deliveries.reduce((n, d) => n + d.ms, 0) / deliveries.length).toFixed(1)} ms round trip), ${only(trace, 'probe').length} probes, ${trace.length} trace entries`,
      );
      expect(deliveries.every((d) => d.status === 200)).toBe(true);
      expect(seconds).toBeLessThan(60);
    } finally {
      if (before === undefined) delete process.env.FF_DELIVERY_TIMEOUT_MS;
      else process.env.FF_DELIVERY_TIMEOUT_MS = before;
    }
  });
});
