import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Customer, CustomerDecision, DecisionBy } from '@fastforward/contracts';
import type { RunDeps } from '../run/run.js';
import { checkUpstreamBase, SANDBOX_BASE, SandboxToken, type SandboxCreds } from '../passthrough.js';

/** What the twin's webhook routes need from a real run: real notices are checked by real PayPal, never by the twin. */
export interface RealVerifier {
  owns(transmissionId: string): boolean;
  verify(body: Record<string, unknown>): Promise<{ status: number; body: unknown }>;
  fetchCert(certId: string): Promise<{ status: number; body: string }>;
  /** The app's own PayPal calls during a real run: its subscription is at PayPal, so the answer has to come from there. */
  forward(method: string, url: string, body: unknown): Promise<{ status: number; body: unknown }>;
}

export interface RealSessionOptions {
  creds: SandboxCreds;
  /** The app's webhook handler. Real notices are forwarded here byte for byte. */
  appWebhookUrl: string;
  /** Public https address that reaches `receiverPort`, such as a tunnel. PayPal posts its notices there. */
  publicUrl: string;
  receiverPort?: number;
  /** Default the real sandbox; only that host or localhost is accepted, so live PayPal can never be reached. */
  sandboxBase?: string;
  /** Where the signing certificates live. Default the sandbox host PayPal names in its notices. */
  certBase?: string;
  /** How long to wait for each notice before saying it did not arrive. */
  waitMs?: number;
  /** The customer played on the real subscription. */
  customer: Customer;
  /** Chooses what the customer does once PayPal has suspended them. */
  decide: NonNullable<RunDeps['decide']>;
  log?: (line: string) => void;
}

export interface RealAction {
  name: string;
  status: number;
  /** The sandbox's own id for what was created or changed. */
  sandboxId?: string;
  expects?: string;
  /** Seconds from the call to the notice reaching us. Undefined when no notice arrived in time. */
  noticeSeconds?: number;
}

export interface RealNotice {
  eventId: string;
  eventType: string;
  resourceId?: string;
  transmissionId: string;
  /** PayPal sent this event before: our resend, or its own retry after the app answered with an error. */
  duplicate: boolean;
  /** What the app answered. Null when the app could not be reached. */
  appStatus: number | null;
  /** What real PayPal said when the app asked; `not-asked` when it never did. */
  verify: 'SUCCESS' | 'FAILURE' | 'not-asked';
}

export interface RealReport {
  subscriptionId: string | null;
  actions: RealAction[];
  notices: RealNotice[];
  /** The app downloaded PayPal's real signing certificate, so it may verify offline. */
  certFetched: boolean;
  /** How PayPal's resend went. It adds a duplicate test; a refusal does not undo what the other notices proved. */
  resend?: 'arrived' | 'not-arrived' | 'refused';
  /** What the customer chose, and who chose it. Absent when the run stopped before they were asked. */
  decision?: { customer: string; decision: CustomerDecision; by?: DecisionBy };
  /** Set when the run stopped early. The webhook is removed either way. */
  error?: string;
}

const EVENT_TYPES = ['BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.CANCELLED', 'PAYMENT.SALE.COMPLETED'];
const MAX_BODY = 1024 * 1024;
/** Sandbox delivery varies: 10 to 54 seconds when it came, and one notice took over 2 minutes (1 Nov 2026). */
const DEFAULT_WAIT_MS = 180_000;
const RESEND_ATTEMPTS = 6;
const RESEND_RETRY_MS = 30_000;
const FORWARD_TIMEOUT_MS = 30_000;
const POLL_MS = 250;

/** The customer whose card fails is the one with a decision to make; otherwise the first. */
export function pickRealCustomer(customers: Customer[]): Customer | undefined {
  return customers.find((c) => c.card.kind === 'fails_from') ?? customers[0];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One real subscription on the real PayPal sandbox: created and suspended, then the customer's own choice is carried
 * out, with PayPal's notices passed unchanged to the app. The suspension is real but its cause is not: the sandbox
 * cannot fail a renewal, so the customer is told their card failed. It proves the app's handler against real payloads
 * and real signatures. The twin takes over from there, for the months the sandbox cannot reach.
 */
export class RealSession implements RealVerifier {
  private readonly base: string;
  private readonly certBase: string;
  private readonly token: SandboxToken;
  private readonly path = `/hook/${randomBytes(16).toString('hex')}`; // unguessable: only PayPal is told this address
  private readonly notices: (Omit<RealNotice, 'verify'> & { at: number })[] = [];
  private readonly verified = new Map<string, 'SUCCESS' | 'FAILURE'>();
  private readonly log: (line: string) => void;
  private webhookId: string | null = null;
  private server: Server | null = null;
  private certFetched = false;

  constructor(private readonly opts: RealSessionOptions) {
    this.base = checkUpstreamBase(opts.sandboxBase ?? SANDBOX_BASE);
    this.certBase = opts.certBase ?? (opts.sandboxBase ? this.base : 'https://api.sandbox.paypal.com');
    this.token = new SandboxToken(this.base, opts.creds);
    this.log = opts.log ?? (() => {});
  }

  owns(transmissionId: string): boolean {
    return this.notices.some((n) => n.transmissionId === transmissionId);
  }

  /** The app's webhook id cannot match the one registered for this run, so ours replaces it. */
  async verify(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const answer = await this.api('POST', '/v1/notifications/verify-webhook-signature', { ...body, webhook_id: this.webhookId });
    const result = (answer.body as { verification_status?: string }).verification_status;
    if (result === 'SUCCESS' || result === 'FAILURE') this.verified.set(String(body.transmission_id), result);
    return answer;
  }

  async fetchCert(certId: string): Promise<{ status: number; body: string }> {
    this.certFetched = true;
    const res = await fetch(`${this.certBase}/v1/notifications/certs/${encodeURIComponent(certId)}`);
    return { status: res.status, body: await res.text() };
  }

  forward(method: string, url: string, body: unknown): Promise<{ status: number; body: unknown }> {
    return this.api(method, url, body);
  }

  async run(): Promise<RealReport> {
    const actions: RealAction[] = [];
    let subscriptionId: string | null = null;
    let error: string | undefined;
    let resend: NonNullable<RealReport['resend']> | undefined;
    let decision: RealReport['decision'];
    const act = async (name: string, path: string, body: unknown, expects?: string): Promise<{ id?: string }> => {
      const seen = expects ? this.count(expects, subscriptionId) : 0;
      const started = Date.now();
      const res = await this.api('POST', path, body);
      if (res.status >= 300) throw new Error(`${name}: the sandbox answered ${res.status}`);
      const id = (res.body as { id?: string } | null)?.id;
      const action: RealAction = { name, status: res.status, ...(id ? { sandboxId: id } : {}), ...(expects ? { expects } : {}) };
      actions.push(action);
      this.log(`real PayPal: ${name} (${res.status})`);
      if (expects) {
        const resource = subscriptionId ?? id ?? null;
        const before = resource === subscriptionId ? seen : 0;
        const arrived = await this.waitFor(() => this.count(expects, resource) > before);
        if (arrived) action.noticeSeconds = (this.latest(expects, resource)!.at - started) / 1000;
        this.log(arrived ? `real PayPal: ${expects} reached your app after ${action.noticeSeconds!.toFixed(0)} s` : `real PayPal: ${expects} did not arrive in time`);
      }
      return id ? { id } : {};
    };

    await this.listen();
    try {
      const hook = await this.api('POST', '/v1/notifications/webhooks', {
        url: `${this.opts.publicUrl.replace(/\/$/, '')}${this.path}`,
        event_types: EVENT_TYPES.map((name) => ({ name })),
      });
      if (hook.status >= 300) throw new Error(`register webhook: the sandbox answered ${hook.status}`);
      this.webhookId = (hook.body as { id: string }).id;

      const product = await act('create product', '/v1/catalogs/products', { name: 'Fastforward real run', type: 'SERVICE', category: 'SOFTWARE' });
      const plan = await act('create plan', '/v1/billing/plans', {
        product_id: product.id,
        name: 'Fastforward real run plan',
        billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: '5.00', currency_code: 'USD' } } }],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
      });
      const created = await act(
        'create subscription',
        '/v1/billing/subscriptions',
        {
          plan_id: plan.id,
          subscriber: {
            name: { given_name: 'Fastforward', surname: 'Probe' },
            email_address: 'fidelity-probe@example.com',
            payment_source: {
              card: {
                name: 'Fastforward Probe',
                number: '4111111111111111', // a generic test number; the sandbox charges nothing real
                expiry: '2030-12',
                security_code: '123',
                billing_address: { address_line_1: '123 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
              },
            },
          },
          application_context: { return_url: 'https://example.com/return', cancel_url: 'https://example.com/cancel' },
        },
        'BILLING.SUBSCRIPTION.ACTIVATED',
      );
      subscriptionId = created.id ?? null;
      const path = `/v1/billing/subscriptions/${subscriptionId}`;
      await act('suspend', `${path}/suspend`, { reason: 'Fastforward real run' }, 'BILLING.SUBSCRIPTION.SUSPENDED');

      decision = await this.askCustomer();
      this.log(`${decision.customer} chose: ${decision.decision.action} (${decision.by === 'model' ? 'decided by Claude' : 'scripted default, Claude did not decide'})`);
      if (decision.decision.action === 'update_card') await act('activate', `${path}/activate`, { reason: 'Customer updated their card' }, 'BILLING.SUBSCRIPTION.ACTIVATED');
      if (decision.decision.action === 'dispute') this.log('real PayPal: the sandbox API cannot open a dispute, so it is not played here. The simulated run covers disputes.');
      // Every run ends cancelled, so no test subscription is left behind; only a customer's own cancel counts as theirs.
      if (decision.decision.action === 'cancel') await act('cancel', `${path}/cancel`, { reason: 'Customer cancelled' }, 'BILLING.SUBSCRIPTION.CANCELLED');
      else await act('cancel (end of run)', `${path}/cancel`, { reason: 'Fastforward real run ended' }, 'BILLING.SUBSCRIPTION.CANCELLED');

      // PayPal's own resend makes a genuine duplicate, with a real signature.
      const first = this.notices.find((n) => n.resourceId === subscriptionId);
      if (first) {
        const before = this.notices.filter((n) => n.eventId === first.eventId).length;
        // A notice can be refused with 404 for a while after delivery (seen once, 1 Nov 2026), so ask again before giving up.
        const retryMs = Math.min((this.opts.waitMs ?? DEFAULT_WAIT_MS) / RESEND_ATTEMPTS, RESEND_RETRY_MS);
        let refusedWith = 0;
        for (let attempt = 1; attempt <= RESEND_ATTEMPTS; attempt++) {
          const res = await this.api('POST', `/v1/notifications/webhooks-events/${first.eventId}/resend`, { webhook_ids: [this.webhookId] });
          refusedWith = res.status < 300 ? 0 : res.status;
          if (refusedWith === 0) break;
          this.log(`real PayPal: resend refused (${res.status}), attempt ${attempt} of ${RESEND_ATTEMPTS}`);
          if (attempt < RESEND_ATTEMPTS) await sleep(retryMs);
        }
        if (refusedWith !== 0) {
          resend = 'refused';
        } else {
          actions.push({ name: 'resend a notice', status: 202, sandboxId: first.eventId });
          resend = (await this.waitFor(() => this.notices.filter((n) => n.eventId === first.eventId).length > before)) ? 'arrived' : 'not-arrived';
        }
        this.log({ arrived: 'real PayPal: the duplicate reached your app', 'not-arrived': 'real PayPal: the duplicate did not arrive in time', refused: 'real PayPal: PayPal refused the resend, so no duplicate was tested' }[resend]);
      }
    } catch (err) {
      error = (err as Error).message;
      this.log(`real PayPal: stopped early: ${error}`);
    } finally {
      await this.cleanUp();
    }
    return {
      subscriptionId,
      actions,
      notices: this.notices.map(({ at: _at, ...n }) => ({ ...n, verify: this.verified.get(n.transmissionId) ?? 'not-asked' })),
      certFetched: this.certFetched,
      ...(resend ? { resend } : {}),
      ...(decision ? { decision } : {}),
      ...(error ? { error } : {}),
    };
  }

  private async askCustomer(): Promise<NonNullable<RealReport['decision']>> {
    const { customer } = this.opts;
    try {
      const out = await this.opts.decide({
        key: `${customer.name}:payment_failed:1`,
        customer,
        point: 'payment_failed',
        at: new Date().toISOString(),
        details: 'Your card was declined and PayPal has suspended your subscription.',
      });
      const { decision, by } = 'decision' in out ? out : { decision: out, by: undefined };
      return { customer: customer.name, decision, ...(by ? { by } : {}) };
    } catch {
      return { customer: customer.name, decision: { action: 'ignore' }, by: 'scripted' }; // a broken decide function must not stop the run
    }
  }

  private count(eventType: string, resource: string | null): number {
    return this.notices.filter((n) => n.eventType === eventType && !n.duplicate && n.resourceId === resource).length;
  }

  private latest(eventType: string, resource: string | null) {
    return this.notices.filter((n) => n.eventType === eventType && !n.duplicate && n.resourceId === resource).at(-1);
  }

  private async waitFor(done: () => boolean): Promise<boolean> {
    const deadline = Date.now() + (this.opts.waitMs ?? DEFAULT_WAIT_MS);
    while (Date.now() < deadline) {
      if (done()) return true;
      await sleep(POLL_MS);
    }
    return done();
  }

  private async api(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const bearer = await this.token.get();
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: the status is what the caller needs.
    }
    return { status: res.status, body: json };
  }

  private async listen(): Promise<void> {
    this.server = createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== this.path) {
        res.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > MAX_BODY) {
          res.writeHead(413).end();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks);
      let event: { id?: string; event_type?: string; resource?: { id?: string; billing_agreement_id?: string } } = {};
      try {
        event = JSON.parse(raw.toString('utf8'));
      } catch {
        res.writeHead(400).end();
        return;
      }
      const eventId = event.id ?? '';
      const transmissionId = String(req.headers['paypal-transmission-id'] ?? '');
      const notice = {
        at: Date.now(),
        eventId,
        eventType: event.event_type ?? '',
        ...(event.resource?.billing_agreement_id || event.resource?.id ? { resourceId: event.resource?.billing_agreement_id ?? event.resource?.id } : {}),
        transmissionId,
        duplicate: this.notices.some((n) => n.eventId === eventId),
        appStatus: null as number | null,
      };
      this.notices.push(notice); // before forwarding: the app's verify call must find it
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if ((name.startsWith('paypal-') || name === 'content-type') && typeof value === 'string') headers[name] = value;
      }
      try {
        const answer = await fetch(this.opts.appWebhookUrl, { method: 'POST', headers, body: raw, signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) });
        notice.appStatus = answer.status;
        res.writeHead(answer.status).end();
      } catch {
        res.writeHead(502).end(); // PayPal retries, as it would for a real app that is down
      }
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.opts.receiverPort ?? 4011, '127.0.0.1', resolve);
    });
  }

  /** The address the receiver ended up on. Tests use port 0. */
  receiverUrl(): string {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}${this.path}`;
  }

  private async cleanUp(): Promise<void> {
    if (this.webhookId) {
      await this.api('DELETE', `/v1/notifications/webhooks/${this.webhookId}`).catch((err) => this.log(`could not remove the test webhook ${this.webhookId}: ${(err as Error).message}`));
    }
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
