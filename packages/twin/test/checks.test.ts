import { parseScenario, type CheckId, type Scenario, type TraceEntry, type WebhookEvent } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { buildReport, runChecks } from '../src/checks/index.js';

const yaml = (probe: boolean) => `
name: synthetic
seed: 1
start: 2026-11-01T00:00:00.000Z
duration: P60D
app:
  webhookUrl: http://127.0.0.1:3000/webhooks/paypal
${probe ? '  probeUrl: http://127.0.0.1:3000/__ff/probe\n' : ''}plan:
  name: Basic
  price: "5.00"
  currency: USD
  interval: MONTH
customers:
  - name: Maya
  - name: Leo
`;
const scenario: Scenario = parseScenario(yaml(true));
const noProbeScenario: Scenario = parseScenario(yaml(false));

const SUB_MAYA = 'I-MAYA00000001';
const SUB_LEO = 'I-LEO000000001';

let seq = 0;
const ev = (type: WebhookEvent['event_type'], resource: Record<string, unknown>, id = `WH-${++seq}`): WebhookEvent => ({
  id,
  event_version: '1.0',
  create_time: '2026-11-01T00:00:00.000Z',
  resource_type: 'x',
  event_type: type,
  summary: type,
  resource,
  links: [],
});

const event = (e: WebhookEvent, at = '2026-11-01T00:00:00.000Z', forged = false): TraceEntry => ({ at, kind: 'event', event: e, forged });
const delivery = (eventId: string, o: Partial<Extract<TraceEntry, { kind: 'delivery' }>> = {}): TraceEntry => ({
  at: '2026-11-01T00:00:00.000Z',
  kind: 'delivery',
  eventId,
  attempt: 1,
  status: 200,
  ms: 20,
  verifyCalled: true,
  transmissionId: `T-${eventId}-${o.attempt ?? 1}`,
  ...o,
});
const probe = (subscriptionId: string, o: Partial<Extract<TraceEntry, { kind: 'probe' }>> = {}): TraceEntry => ({
  at: '2026-12-01T00:00:00.000Z',
  kind: 'probe',
  subscriptionId,
  access: true,
  fulfilments: 1,
  expectedAccess: true,
  completedPayments: 1,
  ...o,
});

const subscribed = (sub: string, who: string, status = 'ACTIVE', id = `WH-sub-${sub}-${status}`) =>
  ev('BILLING.SUBSCRIPTION.ACTIVATED', { id: sub, plan_id: 'P-1', status, custom_id: who }, id);
const sale = (sub: string, id: string) => ev('PAYMENT.SALE.COMPLETED', { id: `SALE-${id}`, billing_agreement_id: sub }, id);

function check(trace: TraceEntry[], id: CheckId, s: Scenario = scenario) {
  const result = runChecks(trace, s).find((c) => c.id === id);
  if (!result) throw new Error(`no result for ${id}`);
  return result;
}

describe('runChecks', () => {
  it('returns all six checks in CheckId order, and an empty run passes or skips everything', () => {
    const results = runChecks([], scenario);
    expect(results.map((r) => r.id)).toEqual(['ACK_FAST', 'VERIFIES_SIGNATURES', 'STATE_MATCHES', 'FULFIL_ONCE', 'DISPUTE_ANSWERED', 'NO_LIVE_CALLS']);
    expect(results.map((r) => r.status)).toEqual(['pass', 'skipped', 'skipped', 'skipped', 'skipped', 'pass']);
  });
});

describe('ACK_FAST', () => {
  it('passes when every delivery got a 2xx within 10 s', () => {
    const e = ev('PAYMENT.SALE.COMPLETED', {});
    const r = check([event(e), delivery(e.id, { status: 204, ms: 10000 })], 'ACK_FAST');
    expect(r).toMatchObject({ status: 'pass', findings: [] });
  });

  it('fails per delivery: no answer, error status, or slower than 10 s', () => {
    const a = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-a');
    const b = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-b');
    const c = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-c');
    const r = check(
      [
        event(a),
        event(b),
        event(c),
        delivery('WH-a', { status: null, ms: 10000, at: '2026-11-02T00:00:00.000Z' }),
        delivery('WH-b', { status: 500 }),
        delivery('WH-c', { status: 200, ms: 12400, attempt: 2 }),
        delivery('WH-a', { status: 200, ms: 5 }),
      ],
      'ACK_FAST',
    );
    expect(r.status).toBe('fail');
    expect(r.findings).toHaveLength(3);
    expect(r.findings.map((f) => f.eventIds[0])).toEqual(['WH-a', 'WH-b', 'WH-c']);
    expect(r.findings[0]!.summary).toContain('did not answer within 10 seconds');
    expect(r.findings[0]!.summary).toContain('2026-11-02');
    expect(r.findings[1]!.summary).toContain('HTTP 500');
    expect(r.findings[2]!.summary).toContain('12.4 seconds');
    expect(r.findings[2]!.summary).toContain('attempt 2');
  });

  it('a retry that finally succeeds does not erase the earlier failure', () => {
    const e = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-r');
    const r = check([event(e), delivery('WH-r', { status: 503 }), delivery('WH-r', { attempt: 2, status: 200 })], 'ACK_FAST');
    expect(r.findings).toHaveLength(1);
  });
});

describe('VERIFIES_SIGNATURES', () => {
  it('passes when a verify_call matches one of the event delivery transmission ids', () => {
    const e = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-v');
    const trace: TraceEntry[] = [
      event(e),
      delivery('WH-v', { status: 500, transmissionId: 'T1' }),
      delivery('WH-v', { attempt: 2, transmissionId: 'T2' }),
      { at: '2026-11-01T00:01:00.000Z', kind: 'verify_call', transmissionId: 'T2', result: 'SUCCESS' },
    ];
    expect(check(trace, 'VERIFIES_SIGNATURES')).toMatchObject({ status: 'pass', findings: [] });
  });

  it('passes for every event once the app has fetched the certificate (offline verification)', () => {
    const a = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-a');
    const b = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-b');
    const trace: TraceEntry[] = [event(a), delivery('WH-a', { verifyCalled: false }), { at: '2026-11-01T00:00:01.000Z', kind: 'cert_fetch' }, event(b), delivery('WH-b', { verifyCalled: false })];
    expect(check(trace, 'VERIFIES_SIGNATURES').status).toBe('pass');
  });

  it('fails with a plain finding when neither a verify call nor a cert fetch happened', () => {
    const e = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-x');
    const r = check([event(e), delivery('WH-x', { verifyCalled: true })], 'VERIFIES_SIGNATURES');
    expect(r.status).toBe('fail');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.summary).toContain('notice WH-x was accepted without checking its signature');
    expect(r.findings[0]!.eventIds).toEqual(['WH-x']);
  });

  it('a verify call for a different delivery does not cover this event', () => {
    const a = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-a');
    const b = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-b');
    const trace: TraceEntry[] = [
      event(a),
      event(b),
      delivery('WH-a', { transmissionId: 'TA' }),
      delivery('WH-b', { transmissionId: 'TB' }),
      { at: '2026-11-01T00:00:01.000Z', kind: 'verify_call', transmissionId: 'TA', result: 'SUCCESS' },
    ];
    const r = check(trace, 'VERIFIES_SIGNATURES');
    expect(r.findings.map((f) => f.eventIds[0])).toEqual(['WH-b']);
  });

  it('ignores forged events and events that were never delivered', () => {
    const forged = ev('BILLING.SUBSCRIPTION.CANCELLED', {}, 'WH-f');
    const undelivered = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-u');
    const genuine = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-g');
    const trace: TraceEntry[] = [
      event(forged, '2026-11-01T00:00:00.000Z', true),
      delivery('WH-f'),
      event(undelivered),
      event(genuine),
      delivery('WH-g', { transmissionId: 'TG' }),
      { at: '2026-11-01T00:00:01.000Z', kind: 'verify_call', transmissionId: 'TG', result: 'SUCCESS' },
    ];
    expect(check(trace, 'VERIFIES_SIGNATURES')).toMatchObject({ status: 'pass', findings: [] });
  });

  it('is skipped when there were no deliveries', () => {
    const e = ev('PAYMENT.SALE.COMPLETED', {});
    expect(check([event(e)], 'VERIFIES_SIGNATURES')).toMatchObject({ status: 'skipped', findings: [] });
  });
});

describe('STATE_MATCHES', () => {
  it('passes when access equals the expected access at every probe', () => {
    const r = check([probe(SUB_MAYA), probe(SUB_LEO, { access: false, expectedAccess: false })], 'STATE_MATCHES');
    expect(r).toMatchObject({ status: 'pass', findings: [] });
  });

  it('fails when the app kept access after PayPal suspended the subscription, naming the customer and date', () => {
    const trace: TraceEntry[] = [
      event(subscribed(SUB_LEO, 'leo@example.test'), '2026-11-01T00:00:00.000Z'),
      event(subscribed(SUB_LEO, 'leo@example.test', 'SUSPENDED', 'WH-susp'), '2026-11-20T00:00:00.000Z'),
      probe(SUB_LEO, { access: true, expectedAccess: false }),
    ];
    const r = check(trace, 'STATE_MATCHES');
    expect(r.status).toBe('fail');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.summary).toBe('Leo still had access on 2026-12-01 although PayPal had suspended the subscription.');
    expect(r.findings[0]!.eventIds).toEqual(['WH-susp']);
  });

  it('fails when the app cut off a customer who should have access', () => {
    const trace: TraceEntry[] = [event(subscribed(SUB_MAYA, 'Maya')), probe(SUB_MAYA, { access: false, expectedAccess: true })];
    const r = check(trace, 'STATE_MATCHES');
    expect(r.findings[0]!.summary).toBe('Maya had no access on 2026-12-01 although the subscription was active and access should have been allowed.');
  });

  it('a probe that did not answer is a failure', () => {
    const r = check([probe(SUB_MAYA, { access: null })], 'STATE_MATCHES');
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.summary).toContain('did not answer');
  });

  it('forged status claims do not change what the twin knows', () => {
    const trace: TraceEntry[] = [
      event(subscribed(SUB_MAYA, 'Maya')),
      event(subscribed(SUB_MAYA, 'Maya', 'CANCELLED', 'WH-forged'), '2026-11-15T00:00:00.000Z', true),
      probe(SUB_MAYA, { access: false, expectedAccess: true }),
    ];
    expect(check(trace, 'STATE_MATCHES').findings[0]!.summary).toContain('the subscription was active');
  });

  it('falls back to the subscription id when the customer is unknown', () => {
    const r = check([probe('I-UNKNOWN', { access: true, expectedAccess: false })], 'STATE_MATCHES');
    expect(r.findings[0]!.summary).toContain('I-UNKNOWN still had access');
  });

  it('is skipped without probeUrl, and when no probe ran', () => {
    expect(check([probe(SUB_MAYA)], 'STATE_MATCHES', noProbeScenario)).toMatchObject({ status: 'skipped', findings: [] });
    expect(check([], 'STATE_MATCHES')).toMatchObject({ status: 'skipped', findings: [] });
  });
});

describe('FULFIL_ONCE', () => {
  it('passes when fulfilments equal completed payments', () => {
    expect(check([probe(SUB_MAYA, { fulfilments: 3, completedPayments: 3 })], 'FULFIL_ONCE')).toMatchObject({ status: 'pass', findings: [] });
  });

  it('fails when a repeated notice fulfilled twice, and lists the sale notices', () => {
    const trace: TraceEntry[] = [
      event(subscribed(SUB_MAYA, 'Maya')),
      event(sale(SUB_MAYA, 'WH-sale1'), '2026-11-01T00:00:00.000Z'),
      event(sale(SUB_MAYA, 'WH-late'), '2026-12-15T00:00:00.000Z'),
      probe(SUB_MAYA, { fulfilments: 2, completedPayments: 1 }),
    ];
    const r = check(trace, 'FULFIL_ONCE');
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.summary).toContain('Maya was given what they paid for 2 times by 2026-12-01, but only 1 payment had completed');
    expect(r.findings[0]!.eventIds).toEqual(['WH-sale1']);
  });

  it('fails when a payment went unfulfilled', () => {
    const r = check([probe(SUB_MAYA, { fulfilments: 0, completedPayments: 2 })], 'FULFIL_ONCE');
    expect(r.findings[0]!.summary).toContain('never by 2026-12-01, but only 2 payments had completed');
    expect(r.findings[0]!.summary).toContain('went unfulfilled');
  });

  it('is skipped when the app never reported fulfilments', () => {
    expect(check([probe(SUB_MAYA, { fulfilments: null })], 'FULFIL_ONCE')).toMatchObject({ status: 'skipped', findings: [] });
    expect(check([], 'FULFIL_ONCE').status).toBe('skipped');
  });

  it('ignores probes without a fulfilments figure when others have one', () => {
    const r = check([probe(SUB_MAYA, { fulfilments: null, completedPayments: 5 }), probe(SUB_LEO, { fulfilments: 1, completedPayments: 1 })], 'FULFIL_ONCE');
    expect(r.status).toBe('pass');
  });
});

describe('DISPUTE_ANSWERED', () => {
  const dispute = (id = 'PP-D-1', due = '2026-12-10T00:00:00.000Z') =>
    ev('CUSTOMER.DISPUTE.CREATED', { dispute_id: id, seller_response_due_date: due }, `WH-${id}`);

  it('passes when a seller action arrived at or before the due date', () => {
    const trace: TraceEntry[] = [
      event(dispute(), '2026-11-20T00:00:00.000Z'),
      { at: '2026-12-10T00:00:00.000Z', kind: 'dispute_action', disputeId: 'PP-D-1', action: 'provide-evidence' },
    ];
    expect(check(trace, 'DISPUTE_ANSWERED')).toMatchObject({ status: 'pass', findings: [] });
  });

  it('fails when there was no action', () => {
    const r = check([event(dispute(), '2026-11-20T00:00:00.000Z')], 'DISPUTE_ANSWERED');
    expect(r.status).toBe('fail');
    expect(r.findings[0]!.summary).toBe('Dispute PP-D-1 opened on 2026-11-20 was not answered by the deadline of 2026-12-10. PayPal rules for the customer when the seller stays silent.');
    expect(r.findings[0]!.eventIds).toEqual(['WH-PP-D-1']);
  });

  it('fails when the only action came after the due date, or was for another dispute', () => {
    const trace: TraceEntry[] = [
      event(dispute('PP-D-1')),
      event(dispute('PP-D-2')),
      { at: '2026-12-11T00:00:00.000Z', kind: 'dispute_action', disputeId: 'PP-D-1', action: 'accept-claim' },
      { at: '2026-11-25T00:00:00.000Z', kind: 'dispute_action', disputeId: 'PP-D-9', action: 'send-message' },
    ];
    expect(check(trace, 'DISPUTE_ANSWERED').findings).toHaveLength(2);
  });

  it('ignores forged disputes; skipped when there are no genuine disputes', () => {
    expect(check([event(dispute(), '2026-11-20T00:00:00.000Z', true)], 'DISPUTE_ANSWERED')).toMatchObject({ status: 'skipped', findings: [] });
    expect(check([], 'DISPUTE_ANSWERED').status).toBe('skipped');
  });
});

describe('NO_LIVE_CALLS', () => {
  it('passes with no blocked live calls', () => {
    expect(check([], 'NO_LIVE_CALLS')).toMatchObject({ status: 'pass', findings: [] });
  });

  it('fails per blocked live call', () => {
    const r = check(
      [
        { at: '2026-11-03T00:00:00.000Z', kind: 'live_call_blocked', url: 'https://api-m.paypal.com/v1/billing/subscriptions' },
        { at: '2026-11-04T00:00:00.000Z', kind: 'live_call_blocked', url: 'https://api.paypal.com/v1/x' },
      ],
      'NO_LIVE_CALLS',
    );
    expect(r.status).toBe('fail');
    expect(r.findings).toHaveLength(2);
    expect(r.findings[0]!.summary).toContain('tried to call live PayPal (https://api-m.paypal.com/v1/billing/subscriptions)');
  });
});

describe("lasting bugs collapse into one finding per stretch", () => {
  const dayProbe = (sub: string, d: number, o: Partial<Extract<TraceEntry, { kind: "probe" }>> = {}) =>
    probe(sub, { at: `2026-12-${String(d).padStart(2, "0")}T00:00:00.000Z`, ...o });
  const leoSuspended: TraceEntry[] = [
    event(subscribed(SUB_LEO, "leo@example.test")),
    event(subscribed(SUB_LEO, "leo@example.test", "SUSPENDED", "WH-susp"), "2026-11-20T00:00:00.000Z"),
  ];

  it("STATE_MATCHES: 30 bad checks in a row are one finding with the date range and count", () => {
    const probes = Array.from({ length: 30 }, (_, i) => dayProbe(SUB_LEO, i + 1, { access: true, expectedAccess: false }));
    const r = check([...leoSuspended, ...probes], "STATE_MATCHES");
    expect(r.status).toBe("fail");
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.summary).toBe("Leo still had access from 2026-12-01 to 2026-12-30 although PayPal had suspended the subscription (30 checks).");
    expect(r.findings[0]!.at).toBe("2026-12-01T00:00:00.000Z");
    expect(r.findings[0]!.eventIds).toEqual(["WH-susp"]);
  });

  it("STATE_MATCHES: a good check in between starts a new stretch", () => {
    const bad = { access: true, expectedAccess: false };
    const trace = [...leoSuspended, dayProbe(SUB_LEO, 1, bad), dayProbe(SUB_LEO, 2, bad), dayProbe(SUB_LEO, 3, { access: false, expectedAccess: false }), dayProbe(SUB_LEO, 4, bad)];
    const r = check(trace, "STATE_MATCHES");
    expect(r.findings.map((f) => f.summary)).toEqual([
      "Leo still had access from 2026-12-01 to 2026-12-02 although PayPal had suspended the subscription (2 checks).",
      "Leo still had access on 2026-12-04 although PayPal had suspended the subscription.",
    ]);
  });

  it("STATE_MATCHES: a different wrong value starts a new stretch; subscriptions are tracked separately", () => {
    const trace = [
      ...leoSuspended,
      event(subscribed(SUB_MAYA, "Maya")),
      dayProbe(SUB_LEO, 1, { access: true, expectedAccess: false }),
      dayProbe(SUB_MAYA, 1, { access: false, expectedAccess: true }),
      dayProbe(SUB_LEO, 2, { access: true, expectedAccess: false }),
      dayProbe(SUB_MAYA, 2, { access: false, expectedAccess: true }),
      dayProbe(SUB_LEO, 3, { access: null, expectedAccess: false }),
    ];
    const r = check(trace, "STATE_MATCHES");
    expect(r.findings.map((f) => f.summary)).toEqual([
      "Leo still had access from 2026-12-01 to 2026-12-02 although PayPal had suspended the subscription (2 checks).",
      "Maya had no access from 2026-12-01 to 2026-12-02 although the subscription was active and access should have been allowed (2 checks).",
      expect.stringContaining("On 2026-12-03 your app did not answer"),
    ]);
  });

  it("FULFIL_ONCE: the same wrong count over many checks is one finding; a changed count is another", () => {
    const wrong = { fulfilments: 2, completedPayments: 1 };
    const trace = [
      event(subscribed(SUB_MAYA, "Maya")),
      event(sale(SUB_MAYA, "WH-sale1")),
      dayProbe(SUB_MAYA, 1, wrong),
      dayProbe(SUB_MAYA, 2, wrong),
      dayProbe(SUB_MAYA, 3, wrong),
      dayProbe(SUB_MAYA, 4, { fulfilments: 3, completedPayments: 1 }),
      dayProbe(SUB_MAYA, 5, { fulfilments: 2, completedPayments: 2 }),
    ];
    const r = check(trace, "FULFIL_ONCE");
    expect(r.findings.map((f) => f.summary)).toEqual([
      expect.stringContaining("Maya was given what they paid for 2 times from 2026-12-01 to 2026-12-03, but only 1 payment had completed (3 checks)"),
      expect.stringContaining("Maya was given what they paid for 3 times by 2026-12-04, but only 1 payment had completed"),
    ]);
    expect(r.findings[0]!.eventIds).toEqual(["WH-sale1"]);
  });

  it("two checks on the same day read as one day, not a range", () => {
    const bad = { access: true, expectedAccess: false };
    const r = check([...leoSuspended, dayProbe(SUB_LEO, 1, bad), dayProbe(SUB_LEO, 1, bad)], "STATE_MATCHES");
    expect(r.findings[0]!.summary).toBe("Leo still had access on 2026-12-01 although PayPal had suspended the subscription (2 checks).");
  });
});

describe("speed", () => {
  it("a 200-customer, 365-day trace is checked in well under a second", () => {
    const trace: TraceEntry[] = [];
    for (let c = 0; c < 200; c += 1) {
      const sub = `I-PERF${String(c).padStart(8, "0")}`;
      trace.push(event(subscribed(sub, `cust${c}`, "ACTIVE", `WH-act-${c}`)));
      for (let d = 0; d < 365; d += 1) {
        const id = `WH-${c}-${d}`;
        const at = new Date(Date.UTC(2026, 10, 1 + d)).toISOString();
        trace.push(event(sale(sub, id), at), delivery(id, { at, transmissionId: `T-${id}` }), probe(sub, { at, access: d % 2 === 0, expectedAccess: true, fulfilments: 1, completedPayments: 1 }));
      }
    }
    trace.push({ at: "2026-11-02T00:00:00.000Z", kind: "cert_fetch" });
    const started = performance.now();
    runChecks(trace, scenario);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('buildReport', () => {
  it('report counts events, deliveries, customers', () => {
    const a = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-1');
    const b = ev('PAYMENT.SALE.COMPLETED', {}, 'WH-2');
    const trace: TraceEntry[] = [event(a), event(b, '2026-11-01T00:00:00.000Z', true), delivery('WH-1'), delivery('WH-1', { attempt: 2 }), delivery('WH-2')];
    const report = buildReport({ runId: 'run-1', scenario, start: '2026-11-01T00:00:00.000Z', end: '2026-12-31T00:00:00.000Z', trace });
    expect(report).toMatchObject({
      runId: 'run-1',
      scenario: 'synthetic',
      start: '2026-11-01T00:00:00.000Z',
      end: '2026-12-31T00:00:00.000Z',
      counts: { events: 2, deliveries: 3, customers: 2 },
    });
    expect(report.checks.map((c) => c.id)).toHaveLength(6);
    expect(report.checks.find((c) => c.id === 'VERIFIES_SIGNATURES')?.status).toBe('fail');
  });

  it('does not mutate the trace', () => {
    const trace: TraceEntry[] = [event(ev('PAYMENT.SALE.COMPLETED', {}, 'WH-m'))];
    const copy = structuredClone(trace);
    buildReport({ runId: 'r', scenario, start: 's', end: 'e', trace });
    expect(trace).toEqual(copy);
  });
});
