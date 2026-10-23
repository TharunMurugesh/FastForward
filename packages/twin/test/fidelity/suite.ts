import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FidelityCheck, FidelityFile } from '../../../../apps/web/src/fidelity.js';
import { createTwin, type Twin } from '../../src/index.js';
import { checkUpstreamBase, SANDBOX_BASE } from '../../src/passthrough.js';
import { assertMatchesSpec } from '../support/openapi.js';
import { diffShapes, shapeOf, type ShapeDiff } from './shape.js';

/**
 * The sandbox fidelity suite (plan Task 14, step 2). It sends identical requests to PayPal's real sandbox and
 * to an in-process twin and compares what comes back: status codes, the shape of each body (keys and value
 * types, never values) and PayPal's own OpenAPI schema. It only ever keeps shapes and statuses.
 *
 * The sandbox is reached with the credentials given to it and nothing else. `sandboxBase` is checked first:
 * only https://api-m.sandbox.paypal.com or localhost (for tests) is accepted, never live PayPal.
 */

export interface SideResult {
  status: number;
  /** The parsed JSON body, or undefined when there was none. Kept in memory only; never written to a file. */
  body: unknown;
}

export interface StepOutcome {
  name: string;
  method: string;
  /** The endpoint with ids replaced by `{id}`: the only form of the path that is ever written down. */
  template: string;
  sandbox: SideResult;
  twin: SideResult;
  diffs: ShapeDiff[];
  specErrors: string[];
}

/** Differences that are expected and understood, per `METHOD template`. Each carries the reason it is fine. */
export type AllowedDiffs = Record<string, { field: string; reason: string }[]>;

/**
 * Real, understood differences between the sandbox and the twin. A field is a dotted path as printed by
 * `diffShapes`, or `(status)` to accept different status codes. Add an entry only after looking at the real
 * difference; the first live run (`npm run fidelity`) is what fills this in. The key is `METHOD template`, or
 * `METHOD template [step name]` for one step when the same endpoint is called more than once.
 */
const TX_REASON =
  'Just after a card subscription is created the sandbox sends none of these fields: the payment shows up in the list later. The twin lists a payment as soon as it is taken, which is what an app under test needs (observed 23 Oct 2026).';

export const ALLOWED_DIFFS: AllowedDiffs = {
  'GET /v1/billing/subscriptions/{id}/transactions [list transactions]': [
    { field: 'links', reason: TX_REASON },
    { field: 'total_items', reason: TX_REASON },
    { field: 'total_pages', reason: TX_REASON },
    { field: 'transactions', reason: TX_REASON },
  ],
};

type Ids = { product?: string; plan?: string; subscription?: string; cardSubscription?: string };

interface Step {
  name: string;
  method: 'GET' | 'POST';
  template: string;
  specFile?: string;
  build(ids: Ids): { path: string; body?: unknown };
  capture?(body: unknown, ids: Ids): void;
}

const idOf = (body: unknown): string | undefined => (typeof (body as { id?: unknown })?.id === 'string' ? (body as { id: string }).id : undefined);

const STEPS: Step[] = [
  {
    name: 'create product',
    method: 'POST',
    template: '/v1/catalogs/products',
    specFile: 'catalogs_products_v1.json',
    build: () => ({ path: '/v1/catalogs/products', body: { name: 'Fastforward fidelity check', description: 'Created by the Fastforward fidelity suite', type: 'SERVICE', category: 'SOFTWARE' } }),
    capture: (body, ids) => void (ids.product = idOf(body)),
  },
  {
    name: 'create plan',
    method: 'POST',
    template: '/v1/billing/plans',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({
      path: '/v1/billing/plans',
      body: {
        product_id: ids.product,
        name: 'Fastforward fidelity plan',
        billing_cycles: [
          {
            frequency: { interval_unit: 'MONTH', interval_count: 1 },
            tenure_type: 'REGULAR',
            sequence: 1,
            total_cycles: 0,
            pricing_scheme: { fixed_price: { value: '5.00', currency_code: 'USD' } },
          },
        ],
        payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 },
      },
    }),
    capture: (body, ids) => void (ids.plan = idOf(body)),
  },
  {
    name: 'create subscription',
    method: 'POST',
    template: '/v1/billing/subscriptions',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: '/v1/billing/subscriptions', body: { plan_id: ids.plan, custom_id: 'fidelity-check' } }),
    capture: (body, ids) => void (ids.subscription = idOf(body)),
  },
  {
    name: 'get subscription',
    method: 'GET',
    template: '/v1/billing/subscriptions/{id}',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.subscription}` }),
  },
  {
    name: 'cancel subscription',
    method: 'POST',
    template: '/v1/billing/subscriptions/{id}/cancel',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.subscription}/cancel`, body: { reason: 'Fastforward fidelity check' } }),
  },
  // ---- the active path -------------------------------------------------------------------------------------
  // A subscription created with a card is ACTIVE at once in the sandbox, with no buyer approval (found 23 Oct 2026,
  // docs/approved-subscriptions-findings.md). That is how the suite reaches everything that needs an active subscription.
  {
    name: 'create subscription with a card',
    method: 'POST',
    template: '/v1/billing/subscriptions',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({
      path: '/v1/billing/subscriptions',
      body: {
        plan_id: ids.plan,
        subscriber: {
          name: { given_name: 'Fastforward', surname: 'Probe' },
          email_address: 'fidelity-probe@example.com',
          payment_source: {
            card: {
              name: 'Fastforward Probe',
              number: '4111111111111111', // a generic non-3DS test number; the sandbox charges nothing real
              expiry: '2030-12',
              security_code: '123',
              billing_address: { address_line_1: '123 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
            },
          },
        },
        application_context: { return_url: 'https://example.com/return', cancel_url: 'https://example.com/cancel' },
      },
    }),
    capture: (body, ids) => void (ids.cardSubscription = idOf(body)),
  },
  {
    name: 'get active subscription',
    method: 'GET',
    template: '/v1/billing/subscriptions/{id}',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}` }),
  },
  {
    name: 'list transactions',
    method: 'GET',
    template: '/v1/billing/subscriptions/{id}/transactions',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}/transactions?start_time=2020-01-01T00:00:00Z&end_time=2035-01-01T00:00:00Z` }),
  },
  {
    name: 'suspend subscription',
    method: 'POST',
    template: '/v1/billing/subscriptions/{id}/suspend',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}/suspend`, body: { reason: 'Fastforward fidelity check' } }),
  },
  {
    name: 'get suspended subscription',
    method: 'GET',
    template: '/v1/billing/subscriptions/{id}',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}` }),
  },
  {
    name: 'activate subscription',
    method: 'POST',
    template: '/v1/billing/subscriptions/{id}/activate',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}/activate`, body: { reason: 'Fastforward fidelity check' } }),
  },
  {
    name: 'cancel active subscription',
    method: 'POST',
    template: '/v1/billing/subscriptions/{id}/cancel',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}/cancel`, body: { reason: 'Fastforward fidelity check' } }),
  },
  {
    name: 'get cancelled subscription',
    method: 'GET',
    template: '/v1/billing/subscriptions/{id}',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}` }),
  },
  {
    name: 'cancel a cancelled subscription (refused)',
    method: 'POST',
    template: '/v1/billing/subscriptions/{id}/cancel',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}/cancel`, body: { reason: 'Fastforward fidelity check' } }),
  },
  {
    name: 'suspend a cancelled subscription (refused)',
    method: 'POST',
    template: '/v1/billing/subscriptions/{id}/suspend',
    specFile: 'billing_subscriptions_v1.json',
    build: (ids) => ({ path: `/v1/billing/subscriptions/${ids.cardSubscription}/suspend`, body: { reason: 'Fastforward fidelity check' } }),
  },
  {
    // Deliberately invalid, so the sandbox's answer is a harmless FAILURE or 400 and nothing is verified for real.
    name: 'verify webhook signature (invalid)',
    method: 'POST',
    template: '/v1/notifications/verify-webhook-signature',
    specFile: 'notifications_webhooks_v1.json',
    build: () => ({
      path: '/v1/notifications/verify-webhook-signature',
      body: {
        auth_algo: 'SHA256withRSA',
        cert_url: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-INVALID',
        transmission_id: 'invalid-transmission-id',
        transmission_sig: 'invalid-signature',
        transmission_time: '2026-01-01T00:00:00Z',
        webhook_id: 'WH-INVALID',
        webhook_event: { id: 'WH-INVALID', event_type: 'PAYMENT.SALE.COMPLETED', resource: {} },
      },
    }),
  },
  {
    name: 'list disputes',
    method: 'GET',
    template: '/v1/customer/disputes',
    specFile: 'customer_disputes_v1.json',
    build: () => ({ path: '/v1/customer/disputes' }),
  },
];

/** A twin with an active run, which is what its subscription routes need. */
export async function startTwinWithRun(): Promise<Twin> {
  const twin = await createTwin({ port: 0 });
  const scenario = {
    name: 'fidelity',
    seed: 1,
    start: '2026-11-01T00:00:00.000Z',
    durationDays: 30,
    app: { webhookUrl: 'http://127.0.0.1:9/webhooks/paypal', webhookId: 'WH-FF-LOCAL' },
    plan: { name: 'Fidelity', price: '5.00', currency: 'USD', interval: 'MONTH', trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 },
    customers: [{ name: 'Probe', email: 'probe@example.test', persona: '', card: { kind: 'ok' }, actions: [] }],
    weather: { duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false },
    expect: { accessWhile: ['ACTIVE'] },
  };
  const res = await fetch(`${twin.url}/_ff/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scenario }) });
  if (res.status !== 201) {
    await twin.close();
    throw new Error(`could not start the twin run (HTTP ${res.status})`);
  }
  return twin;
}

async function accessToken(base: string, clientId: string, clientSecret: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  // Only the status goes into the message: the response body could echo the credentials.
  if (!res.ok) throw new Error(`the token request to ${new URL(base).host} was refused (HTTP ${res.status}); check the client id and secret`);
  const token = ((await res.json()) as { access_token?: unknown }).access_token;
  if (typeof token !== 'string') throw new Error(`the token response from ${new URL(base).host} had no access_token`);
  return token;
}

async function call(base: string, token: string, method: string, path: string, body?: unknown): Promise<SideResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      // Both sides get the full resource back, so their shapes can be compared.
      prefer: 'return=representation',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed };
}

// PayPal's disputes schema says `items` has at least one entry, but the real sandbox returns an empty array when
// there are no disputes. Both sides do that, so this one complaint is not a finding.
const KNOWN_SPEC_QUIRKS = ['/items must NOT have fewer than 1 items'];

function specErrorsFor(step: Step, side: 'sandbox' | 'twin', path: string, result: SideResult): string[] {
  if (!step.specFile || result.status < 200 || result.status >= 300) return [];
  try {
    assertMatchesSpec(step.specFile, path, step.method, result.status, result.body);
    return [];
  } catch (err) {
    const message = (err as Error).message;
    // assertMatchesSpec lists the schema problems after "does not match <file>: ", separated by "; ".
    const marker = message.indexOf('.json: ');
    const problems = marker < 0 ? [message] : message.slice(marker + '.json: '.length).split('; ');
    const real = problems.filter((p) => !KNOWN_SPEC_QUIRKS.includes(p));
    if (marker >= 0 && real.length === 0) return [];
    // Spec trouble is the schema's field names and messages, never response values.
    return [`${side}: ${message.slice(0, 400)}`];
  }
}

export interface SuiteOptions {
  sandboxBase: string;
  sandboxCreds: { clientId: string; clientSecret: string };
  twinUrl: string;
}

/** Runs every step against both sides, in order, and returns what each side said. */
export async function runFidelitySuite(opts: SuiteOptions): Promise<StepOutcome[]> {
  const sandboxBase = checkUpstreamBase(opts.sandboxBase);
  const sandboxToken = await accessToken(sandboxBase, opts.sandboxCreds.clientId, opts.sandboxCreds.clientSecret);
  const twinToken = await accessToken(opts.twinUrl, 'twin', 'twin'); // the twin accepts any credentials

  const sandboxIds: Ids = {};
  const twinIds: Ids = {};
  const outcomes: StepOutcome[] = [];
  for (const step of STEPS) {
    const onSandbox = step.build(sandboxIds);
    const onTwin = step.build(twinIds);
    const sandbox = await call(sandboxBase, sandboxToken, step.method, onSandbox.path, onSandbox.body);
    const twin = await call(opts.twinUrl, twinToken, step.method, onTwin.path, onTwin.body);
    step.capture?.(sandbox.body, sandboxIds);
    step.capture?.(twin.body, twinIds);
    outcomes.push({
      name: step.name,
      method: step.method,
      template: step.template,
      sandbox,
      twin,
      diffs: diffShapes(shapeOf(sandbox.body), shapeOf(twin.body)),
      specErrors: [...specErrorsFor(step, 'sandbox', onSandbox.path, sandbox), ...specErrorsFor(step, 'twin', onTwin.path, twin)],
    });
  }
  return outcomes;
}

export interface Evaluation {
  check: FidelityCheck;
  /** Differences nobody has explained yet, in words. Empty when the endpoint matches or every difference is allowed. */
  unexpected: string[];
  /**
   * Extra detail for the person reading the test output, never written to latest.json: the PayPal error `name` of
   * a non-2xx answer (a fixed constant such as RESOURCE_NOT_FOUND), so a wrong guess can be corrected.
   */
  notes: string[];
}

/** Applies the allowed-differences table to one outcome and produces its line for latest.json. */
export function evaluate(outcome: StepOutcome, allowed: AllowedDiffs): Evaluation {
  const key = `${outcome.method} ${outcome.template}`;
  const table = allowed[`${key} [${outcome.name}]`] ?? allowed[key] ?? [];
  const used = new Map<string, { field: string; reason: string }>();
  const unexpected: string[] = [];

  for (const diff of outcome.diffs) {
    const entry = table.find((a) => a.field === diff.field);
    if (entry) used.set(entry.field, entry);
    else unexpected.push(`${diff.field} (${diff.detail})`);
  }
  if (outcome.sandbox.status !== outcome.twin.status) {
    const entry = table.find((a) => a.field === '(status)');
    if (entry) used.set(entry.field, entry);
    else unexpected.push(`(status) (sandbox ${outcome.sandbox.status}, twin ${outcome.twin.status})`);
  }

  const nameOf = (r: SideResult): string | undefined => {
    const name = (r.body as { name?: unknown } | undefined)?.name;
    return typeof name === 'string' && /^[A-Z0-9_]{3,64}$/.test(name) ? name : undefined;
  };
  const notes: string[] = [];
  const failed = (r: SideResult) => r.status >= 300;
  if (failed(outcome.sandbox) || failed(outcome.twin)) {
    const sandboxName = failed(outcome.sandbox) ? (nameOf(outcome.sandbox) ?? '(no name)') : '(succeeded)';
    const twinName = failed(outcome.twin) ? (nameOf(outcome.twin) ?? '(no body)') : '(succeeded)';
    const sandboxText = outcome.sandbox.body === undefined && failed(outcome.sandbox) ? '(no body)' : sandboxName;
    if (sandboxText !== twinName) notes.push(`error name: sandbox ${sandboxText}, twin ${twinName}`);
  }

  return {
    notes,
    check: {
      endpoint: outcome.template,
      method: outcome.method,
      step: outcome.name,
      sandboxStatus: outcome.sandbox.status,
      twinStatus: outcome.twin.status,
      shapeMatch: unexpected.length === 0,
      specMatch: outcome.specErrors.length === 0,
      allowedDiffs: [...used.values()].map(({ field, reason }) => ({ field, reason })),
    },
    unexpected,
  };
}

export function toFidelityFile(outcomes: StepOutcome[], opts: { sandboxBase?: string; allowed?: AllowedDiffs; ranAt?: string } = {}): FidelityFile {
  return {
    ranAt: opts.ranAt ?? new Date().toISOString(),
    sandboxBase: opts.sandboxBase ?? SANDBOX_BASE,
    checks: outcomes.map((o) => evaluate(o, opts.allowed ?? ALLOWED_DIFFS).check),
  };
}

// What must never reach the file: a PayPal id, a bearer or access token, an email address.
const SENSITIVE = [/\b(?:I|P|PROD|WH|PP-D)-[A-Z0-9]{6,}/, /\bBearer\s/i, /\bA21[A-Za-z0-9_-]{8,}/, /[^\s@"]+@[^\s@"]+\.[^\s@"]+/];

/** Writes the file, after checking that nothing in it looks like an id, token or email. Creates the directory. */
export function writeFidelityFile(path: string, file: FidelityFile): void {
  const text = `${JSON.stringify(file, null, 2)}\n`;
  const hit = SENSITIVE.find((re) => re.test(text));
  if (hit) throw new Error(`refusing to write ${path}: it contains something that looks like an id, token or email (${hit})`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
