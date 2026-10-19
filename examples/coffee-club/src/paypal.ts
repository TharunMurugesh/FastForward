import http from 'node:http';
import { Client, Environment, SubscriptionsController } from '@paypal/paypal-server-sdk';

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
  /** The subscription's current status at PayPal (ACTIVE, SUSPENDED, ...). */
  getSubscriptionStatus(subscriptionId: string): Promise<string | undefined>;
  verifyWebhook(input: VerifyInput): Promise<boolean>;
  provideEvidence(disputeId: string, trackingNumber: string, carrier: string): Promise<void>;
}

export function createPaypalClient(config: PaypalConfig): PaypalClient {
  const base = config.apiBase ?? SANDBOX_BASE;

  // The official SDK has no base-URL option (Sandbox/Production only). For a fake PayPal in unit tests we
  // re-issue its axios request over plain HTTP to that fake with a custom transport.
  const fake = config.apiBase ? new URL(config.apiBase) : null;
  const sdk = new Client({
    environment: Environment.Sandbox,
    clientCredentialsAuthCredentials: { oAuthClientId: config.clientId, oAuthClientSecret: config.clientSecret },
    ...(fake && {
      unstable_httpClientOptions: {
        transport: {
          request: (options: http.RequestOptions, cb: (res: http.IncomingMessage) => void) =>
            http.request({ ...options, protocol: 'http:', hostname: fake.hostname, port: fake.port, agent: undefined }, cb),
        },
      },
    }),
  });
  const subscriptions = new SubscriptionsController(sdk);

  // The SDK has no webhook-verification or disputes call, so those two use fetch.
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
      const { result } = await subscriptions.createSubscription({
        body: { planId, customId: email, subscriber: { name: { givenName: name }, emailAddress: email } },
      });
      if (!result.id) throw new Error('PayPal returned no subscription id');
      return result.id;
    },

    async getSubscriptionStatus(subscriptionId) {
      const { result } = await subscriptions.getSubscription({ id: subscriptionId });
      return result.status;
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
