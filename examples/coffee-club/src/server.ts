import express from 'express';
import { pathToFileURL } from 'node:url';
import { parseBugs, type Bug } from './bugs.js';
import { createPaypalClient, type PaypalClient } from './paypal.js';
import { Store, type Member } from './store.js';

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

    // Webhooks can arrive late or out of order, so the payload is only a hint that something changed.
    // Access follows the subscription's current status at PayPal, unless the trusts-event-order bug is on.
    // Look the status up before changing anything, so a failed lookup leaves no half-applied event.
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

  /** The trusts-event-order bug: believe each event as it arrives. */
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
