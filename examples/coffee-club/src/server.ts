import express from 'express';
import { pathToFileURL } from 'node:url';
import { parseBugs, type Bug } from './bugs.js';
import { createPaypalClient, type PaypalClient } from './paypal.js';
import { Store } from './store.js';

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

    if (bugs.has('no-dedupe') || store.firstSight(event.id)) {
      await apply(event);
    }

    if (bugs.has('slow-ack')) await sleep(config.slowMs);
    res.status(200).end();
  });

  async function apply(event: PaypalEvent): Promise<void> {
    const r = event.resource;
    switch (event.event_type) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED':
        if (r.id) store.member(r.id).access = true;
        break;
      case 'PAYMENT.SALE.COMPLETED':
        if (r.billing_agreement_id) {
          const m = store.member(r.billing_agreement_id);
          m.fulfilments += 1;
          m.access = true;
        }
        break;
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
        if (r.id && !bugs.has('ignores-suspend')) store.member(r.id).access = false;
        break;
      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.EXPIRED':
        if (r.id) store.member(r.id).access = false;
        break;
      case 'CUSTOMER.DISPUTE.CREATED': {
        const disputeId = r.dispute_id ?? r.id;
        if (disputeId && !bugs.has('ignores-disputes')) {
          await paypal.provideEvidence(disputeId, TRACKING.number, TRACKING.carrier).catch(() => undefined);
        }
        break;
      }
    }
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
    bugs: parseBugs(env.COFFEE_BUGS),
    planId: env.PAYPAL_PLAN_ID ?? 'P-COFFEE',
    webhookId: env.PAYPAL_WEBHOOK_ID ?? 'WH-FF-LOCAL',
    slowMs: Number(env.COFFEE_SLOW_MS ?? 12000),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  createApp(configFromEnv()).listen(port, () => console.log(`Coffee Club listening on ${port}`));
}
