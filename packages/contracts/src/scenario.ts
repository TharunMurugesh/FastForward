import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const SUBSCRIPTION_STATUSES = ['APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// The `dispute_reason` enum in PayPal's customer_disputes_v1.json (paypal-rest-api-specifications, Apache-2.0).
export const DISPUTE_REASONS = [
  'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
  'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',
  'UNAUTHORISED',
  'CREDIT_NOT_PROCESSED',
  'DUPLICATE_TRANSACTION',
  'INCORRECT_AMOUNT',
  'PAYMENT_BY_OTHER_MEANS',
  'CANCELED_RECURRING_BILLING',
  'PROBLEM_WITH_REMITTANCE',
  'OTHER',
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];

export type CardBehaviour = { kind: 'ok' } | { kind: 'fails_from'; date: string };

export type CustomerAction =
  | { at: string; do: 'cancel' }
  | { at: string; do: 'update_card' }
  | { at: string; do: 'dispute'; reason: DisputeReason; message?: string };

export interface Customer {
  name: string;
  email: string;
  persona: string;
  card: CardBehaviour;
  actions: CustomerAction[];
}

export interface Weather {
  duplicates: number;
  reorder: number;
  delayMinutes: [number, number];
  forged: number;
  burst: boolean;
}

export interface Scenario {
  name: string;
  seed: number;
  start: string;
  durationDays: number;
  app: { webhookUrl: string; webhookId: string; subscribeUrl?: string; probeUrl?: string };
  plan: {
    name: string;
    price: string;
    currency: string;
    interval: 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
    trialDays: number;
    totalCycles: number;
    paymentFailureThreshold: number;
  };
  customers: Customer[];
  weather: Weather;
  expect: { accessWhile: SubscriptionStatus[] };
}

const isoDate = z.iso.date();
const isoInstant = z.iso.datetime();
const actionTime = z.union([isoDate, isoInstant]);
const chance = z.number().min(0).max(1);

const CardSchema = z.string().transform((value, ctx): CardBehaviour => {
  if (value === 'ok') return { kind: 'ok' };
  const match = /^fails_from:(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (match?.[1] && isoDate.safeParse(match[1]).success) return { kind: 'fails_from', date: match[1] };
  ctx.addIssue({ code: 'custom', message: 'expected "ok" or "fails_from:YYYY-MM-DD"' });
  return z.NEVER;
});

const ActionSchema = z.discriminatedUnion('do', [
  z.object({ at: actionTime, do: z.literal('cancel') }),
  z.object({ at: actionTime, do: z.literal('update_card') }),
  z.object({ at: actionTime, do: z.literal('dispute'), reason: z.enum(DISPUTE_REASONS), message: z.string().optional() }),
]);

const CustomerSchema = z
  .object({
    name: z.string().min(1),
    email: z.email().optional(),
    persona: z.string().default(''),
    card: CardSchema.default({ kind: 'ok' }),
    actions: z.array(ActionSchema).default([]),
  })
  .transform((c): Customer => ({ ...c, email: c.email ?? `${c.name.toLowerCase().replace(/\s+/g, '.')}@example.test` }));

export const ScenarioSchema = z
  .object({
    name: z.string().min(1),
    seed: z.number().int(),
    start: isoInstant,
    duration: z.string().regex(/^P[1-9]\d*D$/, 'expected P<n>D, e.g. P60D'),
    app: z.object({
      webhookUrl: z.url(),
      webhookId: z.string().default('WH-FF-LOCAL'),
      subscribeUrl: z.url().optional(),
      probeUrl: z.url().optional(),
    }),
    plan: z.object({
      name: z.string().min(1),
      price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'expected a decimal string, e.g. "12.00"'),
      currency: z.string().regex(/^[A-Z]{3}$/, 'expected a 3-letter currency code'),
      interval: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']),
      trialDays: z.number().int().min(0).default(0),
      totalCycles: z.number().int().min(0).default(0),
      paymentFailureThreshold: z.number().int().min(1).default(2),
    }),
    customers: z.array(CustomerSchema).min(1),
    weather: z
      .object({
        duplicates: chance.default(0),
        reorder: chance.default(0),
        delayMinutes: z.tuple([z.number().min(0), z.number().min(0)]).default([0, 0]),
        forged: z.number().int().min(0).default(0),
        burst: z.boolean().default(false),
      })
      .default({ duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false }),
    expect: z
      .object({ accessWhile: z.array(z.enum(SUBSCRIPTION_STATUSES)).default(['ACTIVE']) })
      .default({ accessWhile: ['ACTIVE'] }),
  })
  .transform(({ duration, ...rest }): Scenario => ({ ...rest, durationDays: Number(duration.slice(1, -1)) }));

/** Parses scenario YAML; throws an Error listing every problem as `path: message`. */
export function parseScenario(yamlText: string): Scenario {
  const result = ScenarioSchema.safeParse(parseYaml(yamlText));
  if (result.success) return result.data;
  const problems = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
  throw new Error(`invalid scenario:\n  ${problems.join('\n  ')}`);
}
