import type { Scenario } from '@fastforward/contracts';
import { fidelity } from '../fidelity.js';
import { newId } from '../ids.js';
import { addInterval, type Unit } from '../time/calendar.js';
import type { VirtualClock } from '../time/clock.js';
import type { Scheduler } from '../time/scheduler.js';
import type { DomainEvent } from './events.js';
import {
  PayPalError,
  planResource,
  planSummary,
  productResource,
  productSummary,
  saleResource,
  subscriptionResource,
  toCents,
  transactionResource,
  type CycleDef,
  type PlanDef,
  type ProductDef,
  type SubState,
} from './resources.js';

export interface EngineDeps {
  clock: VirtualClock;
  scheduler: Scheduler;
  emit: (e: DomainEvent) => void;
  cardOutcome: (subscriptionId: string, at: Date) => 'ok' | 'fail';
}

export type SubscriptionResource = Record<string, unknown>;

const DAY_MS = 86_400_000;
const UNITS: readonly string[] = ['DAY', 'WEEK', 'MONTH', 'YEAR'];

function invalid(field: string, issue: string, description: string): PayPalError {
  return new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'The requested action could not be performed, semantically incorrect, or failed business validation.', [
    { field, issue, description },
  ]);
}

function selfLink(path: string): { href: string; rel: string; method: string } {
  return { href: `https://api.sandbox.paypal.com${path}`, rel: 'self', method: 'GET' };
}

function notFound(kind: string, id: string): PayPalError {
  return new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', [
    { issue: 'INVALID_RESOURCE_ID', description: `${kind} ${id} does not exist.` },
  ]);
}

/**
 * Products, plans and the subscription lifecycle. Owns no HTTP and no webhooks: it reports what
 * happened through `emit` and moves only when the scheduler's jobs run.
 *
 * Billing model: every cycle starts with a billing event at its boundary (scheduled when the previous
 * cycle started, so retries never shift the anchor). The event charges the cycle price plus any
 * outstanding balance. A failed charge is retried every `retryIntervalDays` up to `maxRetries` times;
 * once retries are exhausted the failure is counted (failed_payments_count + 1, price added to the
 * outstanding balance). A failure that would reach the plan's failure threshold suspends at once.
 */
export class SubscriptionEngine {
  private readonly products = new Map<string, ProductDef>();
  private readonly plans = new Map<string, PlanDef>();
  private readonly subs = new Map<string, SubState>();
  private scenarioPlan: PlanDef | null = null;

  constructor(private readonly deps: EngineDeps) {}

  // ---- catalogue ----------------------------------------------------------------------------

  createProduct(body: unknown): Record<string, unknown> {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.name !== 'string' || b.name === '') throw invalid('/name', 'MISSING_REQUIRED_PARAMETER', 'A required field is missing: name.');
    if (typeof b.type !== 'string' || b.type === '') throw invalid('/type', 'MISSING_REQUIRED_PARAMETER', 'A required field is missing: type.');
    const product: ProductDef = {
      id: newId('PROD'),
      name: b.name,
      type: b.type,
      createTime: this.deps.clock.now(),
      ...(typeof b.description === 'string' ? { description: b.description } : {}),
      ...(typeof b.category === 'string' ? { category: b.category } : {}),
    };
    this.products.set(product.id, product);
    return productResource(product);
  }

  getProduct(id: string): Record<string, unknown> {
    const p = this.products.get(id);
    if (!p) throw notFound('Product', id);
    return productResource(p);
  }

  listProducts(): Record<string, unknown> {
    const products = [...this.products.values()].map(productSummary);
    return { products, total_items: products.length, total_pages: 1, links: [selfLink('/v1/catalogs/products')] };
  }

  createPlan(body: unknown): Record<string, unknown> {
    const b = (body ?? {}) as Record<string, unknown>;
    if (typeof b.name !== 'string' || b.name === '') throw invalid('/name', 'MISSING_REQUIRED_PARAMETER', 'A required field is missing: name.');
    if (typeof b.product_id !== 'string') throw invalid('/product_id', 'MISSING_REQUIRED_PARAMETER', 'A required field is missing: product_id.');
    if (!this.products.has(b.product_id)) throw invalid('/product_id', 'INVALID_PARAMETER_VALUE', `Product ${b.product_id} does not exist.`);
    if (!Array.isArray(b.billing_cycles) || b.billing_cycles.length === 0) {
      throw invalid('/billing_cycles', 'MISSING_REQUIRED_PARAMETER', 'A required field is missing: billing_cycles.');
    }

    let currency = 'USD';
    const cycles: CycleDef[] = b.billing_cycles.map((raw: Record<string, any>, i: number): CycleDef => {
      const unit = raw?.frequency?.interval_unit;
      if (!UNITS.includes(unit)) throw invalid(`/billing_cycles/${i}/frequency/interval_unit`, 'INVALID_PARAMETER_VALUE', 'interval_unit must be DAY, WEEK, MONTH or YEAR.');
      const tenure = raw?.tenure_type;
      if (tenure !== 'REGULAR' && tenure !== 'TRIAL') throw invalid(`/billing_cycles/${i}/tenure_type`, 'INVALID_PARAMETER_VALUE', 'tenure_type must be REGULAR or TRIAL.');
      const price = raw?.pricing_scheme?.fixed_price;
      if (price?.currency_code) currency = price.currency_code;
      if (tenure === 'REGULAR' && !price) {
        throw invalid(`/billing_cycles/${i}/pricing_scheme`, 'MISSING_REQUIRED_PARAMETER', 'A REGULAR cycle needs pricing_scheme.fixed_price.');
      }
      return {
        tenure,
        sequence: Number(raw.sequence ?? i + 1),
        unit: unit as Unit,
        count: Number(raw.frequency.interval_count ?? 1),
        total: Number(raw.total_cycles ?? 1),
        priceCents: price ? toCents(String(price.value)) : 0,
      };
    });
    cycles.sort((a, c) => a.sequence - c.sequence);
    if (!cycles.some((c) => c.tenure === 'REGULAR')) throw invalid('/billing_cycles', 'INVALID_PARAMETER_VALUE', 'A plan needs a REGULAR billing cycle.');

    const prefs = (b.payment_preferences ?? {}) as Record<string, unknown>;
    const plan: PlanDef = {
      id: newId('P'),
      productId: b.product_id,
      name: b.name,
      status: b.status === 'CREATED' || b.status === 'INACTIVE' ? b.status : 'ACTIVE',
      currency,
      cycles,
      failureThreshold: typeof prefs.payment_failure_threshold === 'number' ? prefs.payment_failure_threshold : 0,
      createTime: this.deps.clock.now(),
      ...(typeof b.description === 'string' ? { description: b.description } : {}),
    };
    this.plans.set(plan.id, plan);
    return planResource(plan);
  }

  getPlan(id: string): Record<string, unknown> {
    const p = this.plans.get(id);
    if (!p) throw notFound('Plan', id);
    return planResource(p);
  }

  listPlans(): Record<string, unknown> {
    const plans = [...this.plans.values()].map(planSummary);
    return { plans, total_items: plans.length, total_pages: 1, links: [selfLink('/v1/billing/plans')] };
  }

  /**
   * From now on every subscription uses the scenario's plan, whatever `plan_id` the app sends (the
   * app's real sandbox plan id is unknown to the twin); the app's own `plan_id` string is echoed back.
   */
  usePlan(plan: Scenario['plan']): void {
    const cycles: CycleDef[] = [];
    if (plan.trialDays > 0) {
      cycles.push({ tenure: 'TRIAL', sequence: 1, unit: 'DAY', count: plan.trialDays, total: 1, priceCents: 0 });
    }
    cycles.push({
      tenure: 'REGULAR',
      sequence: cycles.length + 1,
      unit: plan.interval,
      count: 1,
      total: plan.totalCycles,
      priceCents: toCents(plan.price),
    });
    this.scenarioPlan = {
      id: newId('P'),
      productId: newId('PROD'),
      name: plan.name,
      status: 'ACTIVE',
      currency: plan.currency,
      cycles,
      failureThreshold: plan.paymentFailureThreshold,
      createTime: this.deps.clock.now(),
    };
  }

  // ---- subscriptions ------------------------------------------------------------------------

  createSubscription(body: { plan_id: string; custom_id?: string; start_time?: string; subscriber?: { email_address?: string } }): SubscriptionResource {
    if (typeof body?.plan_id !== 'string' || body.plan_id === '') {
      throw invalid('/plan_id', 'MISSING_REQUIRED_PARAMETER', 'A required field is missing: plan_id.');
    }
    const plan = this.scenarioPlan ?? this.plans.get(body.plan_id);
    if (!plan) throw notFound('Plan', body.plan_id);
    if (plan.status !== 'ACTIVE') throw invalid('/plan_id', 'PLAN_NOT_ACTIVE', `Plan ${body.plan_id} is not active.`);

    const now = this.deps.clock.now();
    const start = body.start_time ? new Date(body.start_time) : now;
    if (Number.isNaN(start.getTime())) throw invalid('/start_time', 'INVALID_PARAMETER_VALUE', 'start_time is not a valid date-time.');
    const sub: SubState = {
      id: newId('I'),
      planId: body.plan_id,
      plan,
      status: 'APPROVAL_PENDING',
      statusTime: now,
      startTime: start,
      createTime: now,
      updateTime: now,
      baToken: `BA-${newId('P').slice(2, 19)}`,
      cycleIdx: 0,
      cyclesDone: plan.cycles.map(() => 0),
      anchorIdx: -1,
      anchorDay: 1,
      nextBilling: null,
      failedCount: 0,
      outstandingCents: 0,
      sales: [],
      retryPending: false,
      retryToken: 0,
      ...(body.custom_id !== undefined ? { customId: body.custom_id } : {}),
      ...(body.subscriber?.email_address !== undefined ? { subscriberEmail: body.subscriber.email_address } : {}),
    };
    this.subs.set(sub.id, sub);
    this.emitSubscription('BILLING.SUBSCRIPTION.CREATED', sub);
    return subscriptionResource(sub);
  }

  /** The buyer approves: the subscription goes ACTIVE and the first billing event is queued. */
  approve(id: string): void {
    const sub = this.find(id);
    this.requireStatus(sub, ['APPROVAL_PENDING'], 'approve');
    this.setStatus(sub, 'ACTIVE');
    this.emitSubscription('BILLING.SUBSCRIPTION.ACTIVATED', sub);
    this.queueBoundary(sub, new Date(Math.max(sub.startTime.getTime(), this.deps.clock.now().getTime())));
  }

  cancel(id: string, reason: string): void {
    const sub = this.find(id);
    this.requireStatus(sub, ['APPROVAL_PENDING', 'ACTIVE', 'SUSPENDED'], 'cancel');
    this.stopBilling(sub);
    this.setStatus(sub, 'CANCELLED', reason);
    this.emitSubscription('BILLING.SUBSCRIPTION.CANCELLED', sub);
  }

  suspend(id: string, reason = 'Suspended by the merchant'): void {
    const sub = this.find(id);
    this.requireStatus(sub, ['ACTIVE'], 'suspend');
    this.stopBilling(sub);
    this.setStatus(sub, 'SUSPENDED', reason);
    this.emitSubscription('BILLING.SUBSCRIPTION.SUSPENDED', sub);
  }

  /** Reactivates a suspended subscription; billing restarts now, charging price plus any outstanding balance. */
  activate(id: string, reason = 'Reactivated by the merchant'): void {
    const sub = this.find(id);
    this.requireStatus(sub, ['SUSPENDED'], 'activate');
    this.setStatus(sub, 'ACTIVE', reason);
    sub.anchorIdx = -1;
    this.emitSubscription('BILLING.SUBSCRIPTION.ACTIVATED', sub);
    this.queueBoundary(sub, this.deps.clock.now());
  }

  get(id: string): SubscriptionResource {
    return subscriptionResource(this.find(id));
  }

  transactions(id: string): Record<string, unknown> {
    const sub = this.find(id);
    const transactions = [...sub.sales].reverse().map((s) => transactionResource(sub, s));
    return { transactions, total_items: transactions.length, total_pages: 1, links: [selfLink(`/v1/billing/subscriptions/${id}/transactions`)] };
  }

  completedPayments(id: string): number {
    return this.find(id).sales.length;
  }

  latestSaleId(id: string): string | null {
    return this.find(id).sales.at(-1)?.id ?? null;
  }

  // ---- billing ------------------------------------------------------------------------------

  private queueBoundary(sub: SubState, at: Date): void {
    sub.nextBilling = at;
    this.deps.scheduler.schedule(at, `bill ${sub.id}`, async () => this.onBoundary(sub, at));
  }

  private onBoundary(sub: SubState, at: Date): void {
    if (sub.status !== 'ACTIVE') return;
    const def = sub.plan.cycles[sub.cycleIdx]!;

    if (sub.retryPending) {
      // The previous cycle's retries never finished: count it as failed now.
      sub.retryPending = false;
      sub.retryToken += 1;
      sub.failedCount += 1;
      sub.outstandingCents += def.priceCents;
    }

    if (sub.anchorIdx !== sub.cycleIdx) {
      sub.anchorIdx = sub.cycleIdx;
      sub.anchorDay = at.getUTCDate();
    }
    // Queue the next boundary now, from this cycle's start, so retries never move the billing day.
    this.queueBoundary(sub, addInterval(at, def.unit, def.count, sub.anchorDay));
    this.attempt(sub, 0);
  }

  private attempt(sub: SubState, attemptNo: number): void {
    const now = this.deps.clock.now();
    const def = sub.plan.cycles[sub.cycleIdx]!;
    const due = def.priceCents + sub.outstandingCents;
    if (due === 0) {
      this.completeCycle(sub); // a free trial cycle: nothing to charge
      return;
    }
    if (this.deps.cardOutcome(sub.id, now) === 'ok') {
      this.paid(sub, due, now);
    } else {
      this.failed(sub, attemptNo, due, def, now);
    }
  }

  private paid(sub: SubState, due: number, now: Date): void {
    const sale = { id: newId('SALE'), time: now, amountCents: due };
    sub.sales.push(sale);
    sub.lastPayment = { amountCents: due, time: now };
    delete sub.lastFailed;
    sub.outstandingCents = 0;
    sub.failedCount = 0;
    sub.retryPending = false;
    sub.retryToken += 1;
    const expired = this.completeCycle(sub);
    sub.updateTime = now;
    this.deps.emit({ type: 'PAYMENT.SALE.COMPLETED', resourceType: 'sale', resource: saleResource(sub, sale) });
    if (expired) this.emitSubscription('BILLING.SUBSCRIPTION.EXPIRED', sub);
  }

  private failed(sub: SubState, attemptNo: number, due: number, def: CycleDef, now: Date): void {
    const threshold = sub.plan.failureThreshold;
    const reachesThreshold = threshold > 0 && sub.failedCount + 1 >= threshold;
    const exhausted = attemptNo >= fidelity.maxRetries;
    let retryAt: Date | undefined;

    if (reachesThreshold || exhausted) {
      sub.failedCount += 1;
      sub.outstandingCents += def.priceCents;
      sub.retryPending = false;
    } else {
      retryAt = new Date(now.getTime() + fidelity.retryIntervalDays * DAY_MS);
      sub.retryPending = true;
      const token = sub.retryToken;
      this.deps.scheduler.schedule(retryAt, `retry ${sub.id}`, async () => {
        if (sub.status === 'ACTIVE' && sub.retryToken === token) this.attempt(sub, attemptNo + 1);
      });
    }
    sub.lastFailed = { amountCents: due, time: now, ...(retryAt ? { retryAt } : {}) };
    sub.updateTime = now;
    this.emitSubscription('BILLING.SUBSCRIPTION.PAYMENT.FAILED', sub);

    if (reachesThreshold) {
      this.stopBilling(sub);
      this.setStatus(sub, 'SUSPENDED', 'Reached maximum payment failure threshold');
      this.emitSubscription('BILLING.SUBSCRIPTION.SUSPENDED', sub);
    }
  }

  /** Marks the current cycle done and moves on. Returns true if that was the plan's last cycle. */
  private completeCycle(sub: SubState): boolean {
    const idx = sub.cycleIdx;
    const def = sub.plan.cycles[idx]!;
    sub.cyclesDone[idx] = (sub.cyclesDone[idx] ?? 0) + 1;
    if (def.total === 0 || sub.cyclesDone[idx]! < def.total) return false;
    if (idx < sub.plan.cycles.length - 1) {
      sub.cycleIdx = idx + 1;
      return false;
    }
    this.stopBilling(sub);
    this.setStatus(sub, 'EXPIRED');
    return true;
  }

  private stopBilling(sub: SubState): void {
    sub.nextBilling = null;
    sub.retryPending = false;
    sub.retryToken += 1;
  }

  // ---- helpers ------------------------------------------------------------------------------

  private find(id: string): SubState {
    const sub = this.subs.get(id);
    if (!sub) throw notFound('Subscription', id);
    return sub;
  }

  private requireStatus(sub: SubState, allowed: string[], action: string): void {
    if (!allowed.includes(sub.status)) {
      throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'The requested action could not be performed, semantically incorrect, or failed business validation.', [
        { issue: 'SUBSCRIPTION_STATUS_INVALID', description: `Cannot ${action} a subscription that is ${sub.status}.` },
      ]);
    }
  }

  private setStatus(sub: SubState, status: SubState['status'], note?: string): void {
    const now = this.deps.clock.now();
    sub.status = status;
    sub.statusTime = now;
    sub.updateTime = now;
    if (note !== undefined) sub.statusNote = note;
  }

  private emitSubscription(type: DomainEvent['type'], sub: SubState): void {
    this.deps.emit({ type, resourceType: 'subscription', resource: subscriptionResource(sub) });
  }
}
