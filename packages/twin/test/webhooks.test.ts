import { createVerify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TraceEntry, WebhookEvent } from '@fastforward/contracts';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Scheduler, VirtualClock, type DomainEvent } from '../src/index.js';
import { Dispatcher, nextAttemptAt, VerifyLedger, type DeliveryPolicy } from '../src/webhooks/dispatcher.js';
import { toWebhookEvent } from '../src/webhooks/envelope.js';
import { registerWebhookRoutes } from '../src/webhooks/routes.js';
import { certUrl, crc32, createSigner, signingString, type Signer } from '../src/webhooks/sign.js';

const START = '2026-11-01T00:00:00.000Z';
const WEBHOOK_ID = 'WH-FF-LOCAL';
const MINUTE = 60_000;

const sale: DomainEvent = {
  type: 'PAYMENT.SALE.COMPLETED',
  resourceType: 'sale',
  resource: {
    id: 'SALE123',
    state: 'completed',
    amount: { total: '5.00', currency: 'USD', details: { subtotal: '5.00' } },
    billing_agreement_id: 'I-ABC',
  },
};

interface Delivery {
  rawHeaders: string[];
  headers: IncomingMessage['headers'];
  body: string;
}

/** The developer's app: records every delivery, then answers with whatever `respond` decides. */
class FakeApp {
  deliveries: Delivery[] = [];
  respond: (d: Delivery, res: ServerResponse) => void | Promise<void> = (_d, res) => void res.end('ok');
  private server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const d = { rawHeaders: req.rawHeaders, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
    this.deliveries.push(d);
    await this.respond(d, res);
  });
  url = '';

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/webhooks/paypal`;
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

let signer: Signer;
let twin: FastifyInstance;
let twinUrl: string;
let ledger: VerifyLedger | null = null;
let app: FakeApp;

beforeAll(async () => {
  signer = await createSigner('TEST');
  twin = Fastify({ logger: false });
  registerWebhookRoutes(twin, { signer, ledger: () => ledger });
  await twin.listen({ port: 0, host: '127.0.0.1' });
  twinUrl = `http://127.0.0.1:${(twin.server.address() as AddressInfo).port}`;
  app = new FakeApp();
  await app.start();
}, 60_000);

afterEach(() => {
  app.deliveries = [];
  app.respond = (_d, res) => void res.end('ok');
  ledger = null;
});

afterAll(async () => {
  await app.close();
  await twin.close();
});

/** What the register add-on does inside an app: PayPal's cert host goes to the twin instead. */
const viaTwin = (paypalUrl: string) => paypalUrl.replace('https://api.sandbox.paypal.com', twinUrl);

function setup(opts: { timeoutMs?: number } = {}) {
  const clock = new VirtualClock(START);
  const scheduler = new Scheduler(clock);
  const trace: TraceEntry[] = [];
  ledger = new VerifyLedger();
  const dispatcher = new Dispatcher({
    scheduler,
    clock,
    signer,
    webhookUrl: app.url,
    webhookId: WEBHOOK_ID,
    runId: 'run-test',
    record: (t) => trace.push(t),
    verifyCalls: ledger,
    ...opts,
  });
  const deliveries = () => trace.filter((t): t is Extract<TraceEntry, { kind: 'delivery' }> => t.kind === 'delivery');
  return { clock, scheduler, trace, dispatcher, deliveries };
}

function header(d: Delivery, name: string): string {
  const value = d.headers[name.toLowerCase()];
  if (typeof value !== 'string') throw new Error(`missing header ${name}`);
  return value;
}

/** Verifies a delivery exactly as a PayPal integration does it offline: fetch the cert, CRC the raw body, RSA-verify. */
async function verifyLikeARealApp(d: Delivery): Promise<boolean> {
  const cert = await (await fetch(viaTwin(header(d, 'PAYPAL-CERT-URL')))).text();
  const signed = `${header(d, 'PAYPAL-TRANSMISSION-ID')}|${header(d, 'PAYPAL-TRANSMISSION-TIME')}|${WEBHOOK_ID}|${crc32(d.body)}`;
  return createVerify('SHA256').update(signed).verify(cert, header(d, 'PAYPAL-TRANSMISSION-SIG'), 'base64');
}

/** Asks the twin, as an app using the verify endpoint does. */
async function verifyViaEndpoint(d: Delivery, body = d.body): Promise<string> {
  const res = await fetch(`${twinUrl}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      auth_algo: header(d, 'PAYPAL-AUTH-ALGO'),
      cert_url: header(d, 'PAYPAL-CERT-URL'),
      transmission_id: header(d, 'PAYPAL-TRANSMISSION-ID'),
      transmission_sig: header(d, 'PAYPAL-TRANSMISSION-SIG'),
      transmission_time: header(d, 'PAYPAL-TRANSMISSION-TIME'),
      webhook_id: WEBHOOK_ID,
      webhook_event: JSON.parse(body) as unknown,
    }),
  });
  return ((await res.json()) as { verification_status: string }).verification_status;
}

describe('signing', () => {
  it('crc32 of "hello" is 907060870', () => {
    expect(crc32('hello')).toBe(907060870);
  });

  it('crc32 is unsigned when the top bit is set', () => {
    expect(crc32('a')).toBe(3904355907);
  });

  it('signing string joins id, time, webhook id and crc of the body', () => {
    expect(signingString('T-1', '2026-11-01T00:00:00Z', WEBHOOK_ID, 'hello')).toBe(`T-1|2026-11-01T00:00:00Z|${WEBHOOK_ID}|907060870`);
  });

  it('signer cert id and URL use a PayPal host', () => {
    expect(signer.certId).toBe('CERT-FF-TEST');
    expect(certUrl(signer.certId)).toBe('https://api.sandbox.paypal.com/v1/notifications/certs/CERT-FF-TEST');
  });

  it('signature verifies with node:crypto against served cert', async () => {
    const res = await fetch(`${twinUrl}/v1/notifications/certs/${signer.certId}`);
    expect(res.status).toBe(200);
    const pem = await res.text();
    expect(pem).toContain('-----BEGIN CERTIFICATE-----');
    const input = signingString('T-1', START, WEBHOOK_ID, '{"a":1}');
    expect(createVerify('SHA256').update(input).verify(pem, signer.sign(input), 'base64')).toBe(true);
    expect(signer.verify(input, signer.sign(input))).toBe(true);
    expect(signer.verify(`${input}x`, signer.sign(input))).toBe(false);
    expect(signer.verify(input, 'not a signature')).toBe(false);
  });

  it('unknown cert id is 404', async () => {
    expect((await fetch(`${twinUrl}/v1/notifications/certs/CERT-OTHER`)).status).toBe(404);
  });
});

describe('envelope', () => {
  it('wraps a domain event in the PayPal webhook shape', () => {
    const e: WebhookEvent = toWebhookEvent(sale, new Date(START));
    expect(e).toMatchObject({
      event_version: '1.0',
      create_time: START,
      resource_type: 'sale',
      event_type: 'PAYMENT.SALE.COMPLETED',
      summary: 'Payment completed for $ 5.00 USD',
      resource: sale.resource,
    });
    expect(e.id).toMatch(/^WH-[A-Z0-9]{17}-[A-Z0-9]{17}$/);
    expect(e.links).toEqual([
      { href: `https://api.sandbox.paypal.com/v1/notifications/webhooks-events/${e.id}`, rel: 'self', method: 'GET' },
      { href: `https://api.sandbox.paypal.com/v1/notifications/webhooks-events/${e.id}/resend`, rel: 'resend', method: 'POST' },
    ]);
  });
});

describe('verify endpoint', () => {
  it('returns SUCCESS for a twin-signed event and FAILURE when one byte of the body changes', async () => {
    const { dispatcher } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    const d = app.deliveries[0]!;
    expect(await verifyViaEndpoint(d)).toBe('SUCCESS');
    expect(await verifyViaEndpoint(d, d.body.replace('5.00 USD', '6.00 USD'))).toBe('FAILURE');
  });

  it('returns FAILURE when the cert URL is not the twin cert', async () => {
    const { dispatcher } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    const d = app.deliveries[0]!;
    d.headers['paypal-cert-url'] = 'https://example.test/cert.pem';
    expect(await verifyViaEndpoint(d)).toBe('FAILURE');
  });

  it('rejects a request with missing fields as 400', async () => {
    const res = await fetch(`${twinUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transmission_id: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('delivery', { timeout: 30_000 }, () => {
  it('delivery sends the 6 headers with exact names', async () => {
    const { dispatcher } = setup();
    const event = toWebhookEvent(sale, new Date(START));
    await dispatcher.send(event);
    const d = app.deliveries[0]!;
    const names = d.rawHeaders.filter((_, i) => i % 2 === 0);
    expect(names).toEqual(
      expect.arrayContaining([
        'PAYPAL-AUTH-ALGO',
        'PAYPAL-CERT-URL',
        'PAYPAL-TRANSMISSION-ID',
        'PAYPAL-TRANSMISSION-SIG',
        'PAYPAL-TRANSMISSION-TIME',
        'X-Fastforward-Run',
      ]),
    );
    expect(header(d, 'PAYPAL-AUTH-ALGO')).toBe('SHA256withRSA');
    expect(header(d, 'PAYPAL-CERT-URL')).toBe(certUrl(signer.certId));
    expect(header(d, 'PAYPAL-TRANSMISSION-TIME')).toBe(START);
    expect(header(d, 'X-Fastforward-Run')).toBe('run-test');
    expect(header(d, 'content-type')).toBe('application/json');
    expect(d.body).toBe(JSON.stringify(event));
  });

  it('a real app can verify the delivery offline with the served cert', async () => {
    const { dispatcher } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    expect(await verifyLikeARealApp(app.deliveries[0]!)).toBe(true);
  });

  it('records the event once and one delivery per attempt', async () => {
    const { dispatcher, trace } = setup();
    const event = toWebhookEvent(sale, new Date(START));
    await dispatcher.send(event);
    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual({ at: START, kind: 'event', event, forged: false });
    expect(trace[1]).toMatchObject({ at: START, kind: 'delivery', eventId: event.id, attempt: 1, status: 200, verifyCalled: false });
    const delivery = trace[1] as Extract<TraceEntry, { kind: 'delivery' }>;
    expect(delivery.transmissionId).toBe(header(app.deliveries[0]!, 'PAYPAL-TRANSMISSION-ID'));
  });

  it('non-2xx schedules retry at +1 minute, then +2, +4', async () => {
    app.respond = (_d, res) => {
      res.statusCode = 500;
      res.end();
    };
    const { dispatcher, scheduler, deliveries, trace } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    await scheduler.advanceTo(new Date(Date.parse(START) + 10 * MINUTE));
    const minutes = deliveries().map((d) => (Date.parse(d.at) - Date.parse(START)) / MINUTE);
    expect(minutes).toEqual([0, 1, 3, 7]);
    expect(deliveries().map((d) => [d.attempt, d.status])).toEqual([
      [1, 500],
      [2, 500],
      [3, 500],
      [4, 500],
    ]);
    // Each attempt is a fresh transmission, as with PayPal; the event is recorded once.
    expect(new Set(deliveries().map((d) => d.transmissionId)).size).toBe(4);
    expect(trace.filter((t) => t.kind === 'event')).toHaveLength(1);
    expect(header(app.deliveries[1]!, 'PAYPAL-TRANSMISSION-TIME')).toBe('2026-11-01T00:01:00.000Z');
  });

  it('a 2xx stops the retries', async () => {
    let calls = 0;
    app.respond = (_d, res) => {
      calls += 1;
      res.statusCode = calls < 3 ? 503 : 204;
      res.end();
    };
    const { dispatcher, scheduler, deliveries } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    await scheduler.advanceTo(new Date(Date.parse(START) + 3 * 24 * 60 * MINUTE));
    expect(deliveries().map((d) => d.status)).toEqual([503, 503, 204]);
    expect(scheduler.pending()).toBe(0);
  });

  it('stops after 3 days of doubling retries (the 3-day window binds before 25 attempts)', async () => {
    app.respond = (_d, res) => {
      res.statusCode = 500;
      res.end();
    };
    const { dispatcher, scheduler, deliveries } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    await scheduler.advanceTo(new Date(Date.parse(START) + 10 * 24 * 60 * MINUTE));
    const minutes = deliveries().map((d) => (Date.parse(d.at) - Date.parse(START)) / MINUTE);
    expect(minutes).toEqual([0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095]);
    expect(scheduler.pending()).toBe(0);
  });

  it('stops after 25 attempts when the window allows more', () => {
    const policy: DeliveryPolicy = { firstRetryMinutes: 1, maxAttempts: 25, windowDays: 100_000 };
    const first = new Date(START);
    expect(nextAttemptAt(first, 24, policy)).not.toBeNull();
    expect(nextAttemptAt(first, 25, policy)).toBeNull();
  });

  it('slow app past timeoutMs counts as failed delivery with status null', async () => {
    app.respond = async (_d, res) => {
      await new Promise((r) => setTimeout(r, 1_000));
      if (!res.destroyed) res.end('late');
    };
    const { dispatcher, scheduler, deliveries } = setup({ timeoutMs: 200 });
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    expect(deliveries()[0]).toMatchObject({ attempt: 1, status: null });
    expect(deliveries()[0]!.ms).toBeGreaterThanOrEqual(150);
    expect(deliveries()[0]!.ms).toBeLessThan(1_000);
    expect(scheduler.pending()).toBe(1); // the retry
  });

  it('app that is not running counts as failed delivery with status null', async () => {
    const clock = new VirtualClock(START);
    const trace: TraceEntry[] = [];
    const dispatcher = new Dispatcher({
      scheduler: new Scheduler(clock),
      clock,
      signer,
      webhookUrl: 'http://127.0.0.1:1/webhooks/paypal',
      webhookId: WEBHOOK_ID,
      runId: 'run-test',
      record: (t) => trace.push(t),
      verifyCalls: new VerifyLedger(),
    });
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    expect(trace[1]).toMatchObject({ kind: 'delivery', status: null });
  });

  it('forged event carries a signature that FAILS verification', async () => {
    const { dispatcher, trace } = setup();
    const event = toWebhookEvent({ ...sale, type: 'BILLING.SUBSCRIPTION.CANCELLED', resourceType: 'subscription' }, new Date(START));
    await dispatcher.send(event, { forged: true });
    const d = app.deliveries[0]!;
    expect(header(d, 'PAYPAL-CERT-URL')).toBe(certUrl(signer.certId));
    expect(await verifyViaEndpoint(d)).toBe('FAILURE');
    expect(await verifyLikeARealApp(d)).toBe(false);
    expect(trace[0]).toMatchObject({ kind: 'event', forged: true });
  });

  it('delivery entry records verifyCalled=true when app called verify during the delivery', async () => {
    app.respond = async (d, res) => {
      await verifyViaEndpoint(d);
      res.end('ok');
    };
    const { dispatcher, deliveries } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    expect(deliveries()[0]).toMatchObject({ status: 200, verifyCalled: true });
  });

  it('fetching the cert during the delivery also counts as verifying', async () => {
    app.respond = async (d, res) => {
      await verifyLikeARealApp(d);
      res.end('ok');
    };
    const { dispatcher, deliveries } = setup();
    await dispatcher.send(toWebhookEvent(sale, new Date(START)));
    expect(deliveries()[0]).toMatchObject({ status: 200, verifyCalled: true });
  });

  it('scheduleSend delivers at the given virtual time', async () => {
    const { dispatcher, scheduler, deliveries } = setup();
    const at = new Date(Date.parse(START) + 90 * MINUTE);
    dispatcher.scheduleSend(toWebhookEvent(sale, at), at);
    expect(app.deliveries).toHaveLength(0);
    await scheduler.advanceTo(new Date(Date.parse(START) + 2 * 60 * MINUTE));
    expect(deliveries().map((d) => d.at)).toEqual(['2026-11-01T01:30:00.000Z']);
  });

  it('rejects a non-numeric FF_DELIVERY_TIMEOUT_MS', () => {
    const before = process.env.FF_DELIVERY_TIMEOUT_MS;
    process.env.FF_DELIVERY_TIMEOUT_MS = 'soon';
    try {
      expect(() => setup()).toThrow(/FF_DELIVERY_TIMEOUT_MS/);
    } finally {
      if (before === undefined) delete process.env.FF_DELIVERY_TIMEOUT_MS;
      else process.env.FF_DELIVERY_TIMEOUT_MS = before;
    }
  });
});
