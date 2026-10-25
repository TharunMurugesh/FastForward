import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * JSON over node:http. The fake app must answer "instantly" (Review Focus 5), and on Windows each local
 * fetch costs ~13 ms against ~1 ms here, which would make the twin look slow when the harness is.
 */
function call(method: string, url: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(url, { method, headers: { authorization: 'Bearer app-token', ...(payload && { 'content-type': 'application/json' }) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, json: text ? (JSON.parse(text) as unknown) : null });
      });
    });
    req.on('error', reject);
    req.end(payload);
  });
}

export interface FakeAppOptions {
  /** The twin's URL. The register add-on would redirect sandbox calls here; the fake app calls it directly. */
  twinUrl: string;
  /** false: /subscribe invents an id without calling PayPal, like an app started without the add-on. */
  redirected?: boolean;
  /** true (with redirected false): the app aimed at LIVE PayPal, so the add-on blocked the call and told the twin. */
  blockedLive?: boolean;
  /** With blockedLive: tell the twin this many ms AFTER answering, as the real add-on can (it reports without waiting). */
  blockedLiveReportDelayMs?: number;
  /** Ask the twin's verify endpoint before acting on a webhook. Default true. */
  verify?: boolean;
}

interface Member {
  access: boolean;
  fulfilments: number;
}

/**
 * A minimal app under test, shaped like Coffee Club: subscribes through PayPal, verifies webhooks,
 * dedupes by event id, and on every subscription or sale event re-reads the subscription from PayPal
 * (GET /v1/billing/subscriptions/:id) to decide access. Answers instantly.
 */
export class FakeApp {
  readonly members = new Map<string, Member>();
  readonly events: { id: string; event_type: string }[] = [];
  url = '';
  private readonly seen = new Set<string>();
  private readonly server: Server;

  constructor(private readonly opts: FakeAppOptions) {
    this.server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url ?? '/', 'http://app');
      try {
        if (req.method === 'POST' && url.pathname === '/subscribe') {
          const { name, email } = JSON.parse(raw) as { name: string; email: string };
          const id = await this.subscribe(name, email);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ subscription_id: id }));
        } else if (req.method === 'POST' && url.pathname === '/webhooks/paypal') {
          res.statusCode = await this.webhook(raw, req.headers as Record<string, string>);
          res.end();
        } else if (req.method === 'GET' && url.pathname === '/__ff/probe') {
          const m = this.members.get(url.searchParams.get('subscription_id') ?? '');
          res.setHeader('content-type', 'application/json');
          if (!m) res.statusCode = 404;
          res.end(JSON.stringify(m ?? { error: 'unknown subscription' }));
        } else {
          res.statusCode = 404;
          res.end();
        }
      } catch (err) {
        res.statusCode = 500;
        res.end(String(err));
      }
    });
  }

  get webhookUrl(): string {
    return `${this.url}/webhooks/paypal`;
  }
  get subscribeUrl(): string {
    return `${this.url}/subscribe`;
  }
  get probeUrl(): string {
    return `${this.url}/__ff/probe`;
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async subscribe(name: string, email: string): Promise<string> {
    if (this.opts.redirected === false) {
      // What the register add-on does when an app calls live PayPal: it refuses the call and reports it to the twin.
      if (this.opts.blockedLive) {
        const report = () => call('POST', `${this.opts.twinUrl}/_ff/live-call`, { url: 'https://api-m.paypal.com/v1/billing/subscriptions' }).catch(() => undefined);
        if (this.opts.blockedLiveReportDelayMs === undefined) await report();
        else setTimeout(() => void report(), this.opts.blockedLiveReportDelayMs);
      }
      const id = `I-NOTREDIRECTED${this.members.size}`;
      this.members.set(id, { access: false, fulfilments: 0 });
      return id;
    }
    const res = await call('POST', `${this.opts.twinUrl}/v1/billing/subscriptions`, {
      plan_id: 'P-APP-PLAN',
      custom_id: email,
      subscriber: { name: { given_name: name }, email_address: email },
    });
    if (res.status !== 201) throw new Error(`create subscription failed: ${res.status}`);
    const { id } = res.json as { id: string };
    this.members.set(id, { access: false, fulfilments: 0 });
    return id;
  }

  private async webhook(raw: string, headers: Record<string, string>): Promise<number> {
    const event = JSON.parse(raw) as { id: string; event_type: string; resource: { id?: string; billing_agreement_id?: string } };
    this.events.push({ id: event.id, event_type: event.event_type });

    if (this.opts.verify !== false) {
      const res = await call('POST', `${this.opts.twinUrl}/v1/notifications/verify-webhook-signature`, {
        auth_algo: headers['paypal-auth-algo'],
        cert_url: headers['paypal-cert-url'],
        transmission_id: headers['paypal-transmission-id'],
        transmission_sig: headers['paypal-transmission-sig'],
        transmission_time: headers['paypal-transmission-time'],
        webhook_id: 'WH-FF-LOCAL',
        webhook_event: event,
      });
      const { verification_status } = res.json as { verification_status: string };
      if (verification_status !== 'SUCCESS') return 400;
    }

    if (this.seen.has(event.id)) return 200;
    this.seen.add(event.id);

    const isSale = event.event_type === 'PAYMENT.SALE.COMPLETED';
    const subscriptionId = isSale ? event.resource.billing_agreement_id : event.resource.id;
    if (!subscriptionId || !(isSale || event.event_type.startsWith('BILLING.SUBSCRIPTION.'))) return 200;
    const member = this.members.get(subscriptionId) ?? { access: false, fulfilments: 0 };
    this.members.set(subscriptionId, member);
    const { status } = (await call('GET', `${this.opts.twinUrl}/v1/billing/subscriptions/${subscriptionId}`)).json as { status: string };
    member.access = status === 'ACTIVE';
    if (isSale) member.fulfilments += 1;
    return 200;
  }
}
