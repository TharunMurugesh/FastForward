import type { SubscriptionStatus } from '@fastforward/contracts';
import { newId } from '../ids.js';
import type { Unit } from '../time/calendar.js';

export interface Money {
  currency_code: string;
  value: string;
}

/** "12.34" → 1234. Amounts are kept as integer cents so balances never drift. */
export function toCents(value: string): number {
  const [whole = '0', frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2));
}

export function toMoney(cents: number, currency: string): Money {
  return { currency_code: currency, value: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}` };
}

/** PayPal's error body: `{name, message, debug_id, details?, links}`. */
export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly errorName: string,
    message: string,
    readonly details: { field?: string; issue: string; description?: string }[] = [],
  ) {
    super(message);
  }

  body(): Record<string, unknown> {
    return {
      name: this.errorName,
      message: this.message,
      debug_id: newId('SALE').toLowerCase(),
      ...(this.details.length > 0 ? { details: this.details } : {}),
      links: [{ href: 'https://developer.paypal.com/docs/api/v1/billing/subscriptions#errors', rel: 'information_link' }],
    };
  }
}

// ---- products -------------------------------------------------------------------------------

export interface ProductDef {
  id: string;
  name: string;
  description?: string;
  type: string;
  category?: string;
  createTime: Date;
}

const API = 'https://api.sandbox.paypal.com';

export function productResource(p: ProductDef): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    ...(p.description !== undefined ? { description: p.description } : {}),
    type: p.type,
    ...(p.category !== undefined ? { category: p.category } : {}),
    create_time: p.createTime.toISOString(),
    update_time: p.createTime.toISOString(),
    links: [{ href: `${API}/v1/catalogs/products/${p.id}`, rel: 'self', method: 'GET' }],
  };
}

export function productSummary(p: ProductDef): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    ...(p.description !== undefined ? { description: p.description } : {}),
    create_time: p.createTime.toISOString(),
    links: [{ href: `${API}/v1/catalogs/products/${p.id}`, rel: 'self', method: 'GET' }],
  };
}

// ---- plans ----------------------------------------------------------------------------------

export interface CycleDef {
  tenure: 'TRIAL' | 'REGULAR';
  sequence: number;
  unit: Unit;
  count: number;
  /** 0 = repeats forever. */
  total: number;
  priceCents: number;
}

export interface PlanDef {
  id: string;
  productId: string;
  name: string;
  description?: string;
  status: 'CREATED' | 'INACTIVE' | 'ACTIVE';
  currency: string;
  /** Sorted by sequence. */
  cycles: CycleDef[];
  /** 0 = never suspend. */
  failureThreshold: number;
  createTime: Date;
}

export function planBillingCycles(plan: PlanDef): Record<string, unknown>[] {
  return plan.cycles.map((c) => ({
    frequency: { interval_unit: c.unit, interval_count: c.count },
    tenure_type: c.tenure,
    sequence: c.sequence,
    total_cycles: c.total,
    pricing_scheme: {
      version: 1,
      fixed_price: toMoney(c.priceCents, plan.currency),
      create_time: plan.createTime.toISOString(),
      update_time: plan.createTime.toISOString(),
    },
  }));
}

export function planPaymentPreferences(plan: PlanDef): Record<string, unknown> {
  return {
    auto_bill_outstanding: true,
    setup_fee: { currency_code: plan.currency, value: '0' },
    setup_fee_failure_action: 'CANCEL',
    payment_failure_threshold: plan.failureThreshold,
    service_type: 'PREPAID',
  };
}

export function planResource(plan: PlanDef): Record<string, unknown> {
  return {
    id: plan.id,
    product_id: plan.productId,
    name: plan.name,
    status: plan.status,
    ...(plan.description !== undefined ? { description: plan.description } : {}),
    billing_cycles: planBillingCycles(plan),
    payment_preferences: planPaymentPreferences(plan),
    quantity_supported: false,
    usage_type: 'LICENSED',
    create_time: plan.createTime.toISOString(),
    update_time: plan.createTime.toISOString(),
    links: [{ href: `${API}/v1/billing/plans/${plan.id}`, rel: 'self', method: 'GET', encType: 'application/json' }],
  };
}

export function planSummary(plan: PlanDef): Record<string, unknown> {
  return {
    id: plan.id,
    product_id: plan.productId,
    name: plan.name,
    status: plan.status,
    ...(plan.description !== undefined ? { description: plan.description } : {}),
    create_time: plan.createTime.toISOString(),
    links: [{ href: `${API}/v1/billing/plans/${plan.id}`, rel: 'self', method: 'GET' }],
  };
}

// ---- subscriptions --------------------------------------------------------------------------

export interface SaleDef {
  id: string;
  time: Date;
  amountCents: number;
}

export interface SubState {
  id: string;
  /** The plan id the app sent (echoed back); `plan` is what the twin actually bills. */
  planId: string;
  plan: PlanDef;
  status: SubscriptionStatus;
  statusNote?: string;
  statusTime: Date;
  startTime: Date;
  createTime: Date;
  updateTime: Date;
  baToken: string;
  customId?: string;
  /** The `subscriber` object from the create request, echoed back (empty when the request had none). */
  subscriber: Record<string, unknown>;
  subscriberEmail?: string;
  shippingAmount?: Money;
  /** Index into plan.cycles of the cycle being billed. */
  cycleIdx: number;
  cyclesDone: number[];
  anchorIdx: number;
  anchorDay: number;
  nextBilling: Date | null;
  failedCount: number;
  outstandingCents: number;
  lastPayment?: { amountCents: number; time: Date };
  lastFailed?: { amountCents: number; time: Date; retryAt?: Date };
  sales: SaleDef[];
  retryPending: boolean;
  /** Bumped whenever queued retries must be ignored. */
  retryToken: number;
}

function links(sub: SubState): Record<string, unknown>[] {
  const self = `${API}/v1/billing/subscriptions/${sub.id}`;
  return [
    ...(sub.status === 'APPROVAL_PENDING'
      ? [{ href: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${sub.baToken}`, rel: 'approve', method: 'GET' }]
      : []),
    { href: self, rel: 'edit', method: 'PATCH' },
    { href: self, rel: 'self', method: 'GET' },
  ];
}

/**
 * How much of a subscription the caller sees, matching what PayPal's sandbox returns (first live fidelity run):
 * - `create`: the POST response. `get`: GET. `event`: the resource inside a webhook notice.
 * - While the subscription still waits for approval there is no billing_info, update_time or shipping_amount, and
 *   GET has no status_update_time either.
 * - The plan is only included when asked for (`?fields=plan`), and in webhook notices.
 */
export interface SubscriptionView {
  context: 'create' | 'get' | 'event';
  includePlan?: boolean;
}

export function subscriptionResource(sub: SubState, view: SubscriptionView = { context: 'event', includePlan: true }): Record<string, unknown> {
  const { plan } = sub;
  const waiting = sub.status === 'APPROVAL_PENDING' || sub.status === 'APPROVED';
  const hideStatusTime = waiting && view.context === 'get';
  return {
    id: sub.id,
    plan_id: sub.planId,
    status: sub.status,
    ...(sub.statusNote !== undefined ? { status_change_note: sub.statusNote } : {}),
    ...(hideStatusTime ? {} : { status_update_time: sub.statusTime.toISOString() }),
    start_time: sub.startTime.toISOString(),
    quantity: '1',
    ...(sub.shippingAmount ? { shipping_amount: sub.shippingAmount } : {}),
    subscriber: sub.subscriber,
    ...(waiting
      ? {}
      : {
          billing_info: {
            outstanding_balance: toMoney(sub.outstandingCents, plan.currency),
            cycle_executions: plan.cycles.map((c, i) => ({
              tenure_type: c.tenure,
              sequence: c.sequence,
              cycles_completed: sub.cyclesDone[i] ?? 0,
              ...(c.total > 0 ? { cycles_remaining: Math.max(c.total - (sub.cyclesDone[i] ?? 0), 0) } : {}),
              total_cycles: c.total,
            })),
            ...(sub.lastPayment
              ? { last_payment: { amount: toMoney(sub.lastPayment.amountCents, plan.currency), time: sub.lastPayment.time.toISOString() } }
              : {}),
            ...(sub.nextBilling && sub.status === 'ACTIVE' ? { next_billing_time: sub.nextBilling.toISOString() } : {}),
            failed_payments_count: sub.failedCount,
            ...(sub.lastFailed
              ? {
                  last_failed_payment: {
                    amount: toMoney(sub.lastFailed.amountCents, plan.currency),
                    time: sub.lastFailed.time.toISOString(),
                    reason_code: 'PAYMENT_DENIED',
                    ...(sub.lastFailed.retryAt ? { next_payment_retry_time: sub.lastFailed.retryAt.toISOString() } : {}),
                  },
                }
              : {}),
          },
        }),
    create_time: sub.createTime.toISOString(),
    ...(waiting ? {} : { update_time: sub.updateTime.toISOString() }),
    ...(sub.customId !== undefined ? { custom_id: sub.customId } : {}),
    plan_overridden: false,
    ...(view.includePlan
      ? {
          plan: {
            product_id: plan.productId,
            name: plan.name,
            billing_cycles: planBillingCycles(plan),
            payment_preferences: planPaymentPreferences(plan),
            quantity_supported: false,
          },
        }
      : {}),
    links: links(sub),
  };
}

export function saleResource(sub: SubState, sale: SaleDef): Record<string, unknown> {
  const total = toMoney(sale.amountCents, sub.plan.currency);
  return {
    id: sale.id,
    state: 'completed',
    amount: { total: total.value, currency: total.currency_code, details: { subtotal: total.value } },
    billing_agreement_id: sub.id,
    create_time: sale.time.toISOString(),
  };
}

export function transactionResource(sub: SubState, sale: SaleDef): Record<string, unknown> {
  const gross = toMoney(sale.amountCents, sub.plan.currency);
  return {
    status: 'COMPLETED',
    id: sale.id,
    amount_with_breakdown: { gross_amount: gross },
    ...(sub.subscriberEmail !== undefined ? { payer_email: sub.subscriberEmail } : {}),
    time: sale.time.toISOString(),
  };
}
