import express from 'express';
import { pathToFileURL } from 'node:url';

export const BUG_NAMES = ['no-verify', 'no-dedupe', 'slow-ack', 'ignores-suspend', 'ignores-disputes', 'trusts-event-order'] as const;
export type Bug = (typeof BUG_NAMES)[number];

/** Parses SHOP_BUGS: `none` (default), `all`, or a comma list of bug names. */
export function parseBugs(value: string | undefined): Set<Bug> {
  const text = (value ?? 'none').trim().toLowerCase();
  if (text === '' || text === 'none') return new Set();
  if (text === 'all') return new Set(BUG_NAMES);
  const bugs = new Set<Bug>();
  for (const name of text.split(',').map((s) => s.trim())) {
    if (!(BUG_NAMES as readonly string[]).includes(name)) {
      throw new Error(`unknown SHOP_BUGS entry "${name}" (use none, all or: ${BUG_NAMES.join(', ')})`);
    }
    bugs.add(name as Bug);
  }
  return bugs;
}

export interface Member {
  subscriptionId: string;
  email: string;
  access: boolean;
  fulfilments: number;
}

/** In-memory state: who is subscribed, what they can use, which events were already handled. */
export class Store {
  private readonly members = new Map<string, Member>();
  private readonly seenEvents = new Set<string>();

  member(subscriptionId: string, email = ''): Member {
    let m = this.members.get(subscriptionId);
    if (!m) {
      m = { subscriptionId, email, access: false, fulfilments: 0 };
      this.members.set(subscriptionId, m);
    }
    return m;
  }

  find(subscriptionId: string): Member | undefined {
    return this.members.get(subscriptionId);
  }

  forget(eventId: string): void {
    this.seenEvents.delete(eventId);
  }

  firstSight(eventId: string): boolean {
    if (this.seenEvents.has(eventId)) return false;
    this.seenEvents.add(eventId);
    return true;
  }
}

export const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

export interface PaypalConfig {
  clientId: string;
  clientSecret: string;
  /** Unit tests only: a local fake PayPal. Real runs leave it unset and the register add-on redirects. */
  apiBase?: string;
}

export interface VerifyInput {
  headers: Record<string, string | undefined>;
  webhookId: string;
  event: unknown;
}

export interface PaypalClient {
  createSubscription(planId: string, name: string, email: string): Promise<string>;
  getSubscriptionStatus(subscriptionId: string): Promise<string | undefined>;
  verifyWebhook(input: VerifyInput): Promise<boolean>;
  provideEvidence(disputeId: string, trackingNumber: string, carrier: string): Promise<void>;
}

export function createPaypalClient(config: PaypalConfig): PaypalClient {
  const base = config.apiBase ?? SANDBOX_BASE;
  let token: { value: string; expiresAt: number } | null = null;

  async function bearer(): Promise<string> {
    if (token && token.expiresAt > Date.now()) return token.value;
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal token request failed (${res.status})`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
    return token.value;
  }

  return {
    async createSubscription(planId, name, email) {
      const res = await fetch(`${base}/v1/billing/subscriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await bearer()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: planId,
          custom_id: email,
          subscriber: { name: { given_name: name }, email_address: email },
        }),
      });
      if (!res.ok) throw new Error(`create subscription failed (${res.status})`);
      const body = (await res.json()) as { id?: string };
      if (!body.id) throw new Error('PayPal returned no subscription id');
      return body.id;
    },

    async getSubscriptionStatus(subscriptionId) {
      const res = await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${await bearer()}` },
      });
      if (!res.ok) throw new Error(`get subscription failed (${res.status})`);
      const body = (await res.json()) as { status?: string };
      return body.status;
    },

    async verifyWebhook({ headers, webhookId, event }) {
      const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await bearer()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_algo: headers['paypal-auth-algo'],
          cert_url: headers['paypal-cert-url'],
          transmission_id: headers['paypal-transmission-id'],
          transmission_sig: headers['paypal-transmission-sig'],
          transmission_time: headers['paypal-transmission-time'],
          webhook_id: webhookId,
          webhook_event: event,
        }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { verification_status?: string };
      return body.verification_status === 'SUCCESS';
    },

    async provideEvidence(disputeId, trackingNumber, carrier) {
      const input = { evidences: [{ evidence_type: 'PROOF_OF_FULFILLMENT', tracking_info: [{ carrier_name: carrier, tracking_number: trackingNumber }] }] };
      const form = new FormData();
      form.append('input', new Blob([JSON.stringify(input)], { type: 'application/json' }), 'input.json');
      const res = await fetch(`${base}/v1/customer/disputes/${encodeURIComponent(disputeId)}/provide-evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await bearer()}` },
        body: form,
      });
      if (!res.ok) throw new Error(`provide-evidence failed (${res.status})`);
    },
  };
}

export interface AppConfig {
  paypal: PaypalClient;
  bugs: Set<Bug>;
  planId: string;
  webhookId: string;
  slowMs: number;
}

const TRACKING = { carrier: 'UPS', number: '1Z999AA10123456784' };

interface PaypalEvent {
  id: string;
  event_type: string;
  resource: { id?: string; billing_agreement_id?: string; dispute_id?: string };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createApp(config: AppConfig): express.Express {
  const { paypal, bugs } = config;
  const store = new Store();
  const app = express();
  app.use(express.json());

  app.post('/subscribe', async (req, res) => {
    const { name, email } = req.body ?? {};
    if (typeof name !== 'string' || typeof email !== 'string' || !name || !email) {
      res.status(400).json({ error: 'name and email are required' });
      return;
    }
    try {
      const subscriptionId = await paypal.createSubscription(config.planId, name, email);
      store.member(subscriptionId, email);
      res.json({ subscription_id: subscriptionId });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'PayPal call failed' });
    }
  });

  app.post('/webhooks/paypal', async (req, res) => {
    const event = req.body as PaypalEvent;
    if (!event?.id || !event.event_type) {
      res.status(400).end();
      return;
    }

    if (!bugs.has('no-verify')) {
      const ok = await paypal
        .verifyWebhook({ headers: req.headers as Record<string, string | undefined>, webhookId: config.webhookId, event })
        .catch(() => false);
      if (!ok) {
        res.status(400).json({ error: 'signature check failed' });
        return;
      }
    }

    if (bugs.has('no-dedupe')) {
      await apply(event);
    } else if (store.firstSight(event.id)) {
      try {
        await apply(event);
      } catch (err) {
        store.forget(event.id); // let PayPal's retry be handled, not skipped as a repeat
        throw err;
      }
    }

    if (bugs.has('slow-ack')) await sleep(config.slowMs);
    res.status(200).end();
  });

  async function apply(event: PaypalEvent): Promise<void> {
    const r = event.resource;
    const type = event.event_type;
    const isSale = type === 'PAYMENT.SALE.COMPLETED';

    if (isSale || type.startsWith('BILLING.SUBSCRIPTION.')) {
      const subscriptionId = isSale ? r.billing_agreement_id : r.id;
      if (subscriptionId) {
        const member = store.member(subscriptionId);
        if (bugs.has('trusts-event-order')) {
          applyPayload(member, type);
        } else if (!(bugs.has('ignores-suspend') && type === 'BILLING.SUBSCRIPTION.SUSPENDED')) {
          const status = await paypal.getSubscriptionStatus(subscriptionId);
          member.access = status === 'ACTIVE' || (bugs.has('ignores-suspend') && status === 'SUSPENDED');
        }
        if (isSale) member.fulfilments += 1;
      }
    }

    switch (type) {
      case 'CUSTOMER.DISPUTE.CREATED': {
        const disputeId = r.dispute_id ?? r.id;
        if (disputeId && !bugs.has('ignores-disputes')) {
          await paypal.provideEvidence(disputeId, TRACKING.number, TRACKING.carrier).catch(() => undefined);
        }
        break;
      }
    }
  }

  function applyPayload(member: Member, type: string): void {
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED' || type === 'PAYMENT.SALE.COMPLETED') member.access = true;
    else if (type === 'BILLING.SUBSCRIPTION.SUSPENDED' && !bugs.has('ignores-suspend')) member.access = false;
    else if (type === 'BILLING.SUBSCRIPTION.CANCELLED' || type === 'BILLING.SUBSCRIPTION.EXPIRED') member.access = false;
  }

  app.get('/__ff/probe', (req, res) => {
    const m = store.find(String(req.query.subscription_id ?? ''));
    if (!m) {
      res.status(404).json({ error: 'unknown subscription' });
      return;
    }
    res.json({ access: m.access, fulfilments: m.fulfilments });
  });

  return app;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    paypal: createPaypalClient({
      clientId: env.PAYPAL_CLIENT_ID ?? '',
      clientSecret: env.PAYPAL_CLIENT_SECRET ?? '',
      ...(env.PAYPAL_API_BASE && { apiBase: env.PAYPAL_API_BASE }),
    }),
    bugs: parseBugs(env.SHOP_BUGS),
    planId: env.PAYPAL_PLAN_ID ?? 'P-SHOP',
    webhookId: env.PAYPAL_WEBHOOK_ID ?? 'WH-FF-LOCAL',
    slowMs: Number(env.SHOP_SLOW_MS ?? 12000),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp(configFromEnv()).listen(port, () => console.log(`Plain Fetch Shop listening on ${port}`));
}

