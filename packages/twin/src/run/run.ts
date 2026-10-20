import { randomBytes } from 'node:crypto';
import type { Customer, CustomerAction, CustomerDecision, Scenario, SubscriptionStatus, TraceEntry, Weather, WebhookEvent } from '@fastforward/contracts';
import { DisputeEngine } from '../disputes/engine.js';
import { SubscriptionEngine } from '../subscriptions/engine.js';
import type { DomainEvent } from '../subscriptions/events.js';
import { PayPalError, type Money } from '../subscriptions/resources.js';
import { VirtualClock } from '../time/clock.js';
import { Scheduler } from '../time/scheduler.js';
import { Dispatcher, VerifyLedger } from '../webhooks/dispatcher.js';
import { toWebhookEvent } from '../webhooks/envelope.js';
import { forgedEvents, mulberry32, planDeliveries } from '../webhooks/weather.js';
import type { Signer } from '../webhooks/sign.js';
import { CustomerBook } from './customers.js';
import { probe } from './probe.js';

const DAY_MS = 86_400_000;
const SUBSCRIBE_TIMEOUT_MS = 30_000;

/** Spec §11: the run aborts with this when the app's subscribe step never reaches the twin. */
export const NOT_REDIRECTED = "your app isn't redirected — start it with `FASTFORWARD=1 node --import fastforward-register`";

/** Same shape as `@fastforward/ai`'s DecisionContext; the twin takes a function and never imports the AI package. */
export interface DecisionContext {
  /** Lock key, `<customer>:<point>:<n>`. */
  key: string;
  customer: Customer;
  point: 'payment_failed' | 'seller_message';
  at: string;
  details: string;
}

export interface RunDeps {
  decide?: (ctx: DecisionContext) => Promise<CustomerDecision>;
}

/**
 * One scenario against one app: its own clock, scheduler, subscription engine and webhook dispatcher.
 * Everything that happens is appended to `trace`, which the checks read.
 */
export class Run {
  readonly id = `run-${randomBytes(4).toString('hex')}`;
  readonly trace: TraceEntry[] = [];
  readonly clock: VirtualClock;
  readonly scheduler: Scheduler;
  readonly engine: SubscriptionEngine;
  readonly disputes: DisputeEngine;
  readonly ledger = new VerifyLedger();
  readonly end: Date;
  finished = false;

  private readonly dispatcher: Dispatcher;
  private readonly book: CustomerBook;
  private readonly listeners = new Set<(t: TraceEntry) => void>();
  private readonly finishListeners = new Set<() => void>();
  private readonly checkpointDays = new Set<string>();
  private subscriptionCreates = 0;
  private readonly rng: () => number;
  private readonly weather: Weather;
  /** Events emitted at the current virtual instant, waiting for the weather to decide when they go out. */
  private batch: { event: WebhookEvent; at: Date }[] = [];
  private flushQueued = false;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly scenario: Scenario,
    signer: Signer,
    private readonly deps: RunDeps = {},
  ) {
    this.clock = new VirtualClock(scenario.start);
    this.scheduler = new Scheduler(this.clock);
    this.end = new Date(this.clock.now().getTime() + scenario.durationDays * DAY_MS);
    this.book = new CustomerBook();
    this.rng = mulberry32(scenario.seed);
    const w: Partial<Weather> = scenario.weather ?? {};
    this.weather = { duplicates: w.duplicates ?? 0, reorder: w.reorder ?? 0, delayMinutes: w.delayMinutes ?? [0, 0], forged: w.forged ?? 0, burst: w.burst ?? false };
    this.engine = new SubscriptionEngine({
      clock: this.clock,
      scheduler: this.scheduler,
      emit: (e) => this.onDomainEvent(e),
      cardOutcome: (id, at) => this.book.cardOutcome(id, at),
    });
    this.disputes = new DisputeEngine({
      clock: this.clock,
      scheduler: this.scheduler,
      emit: (e) => this.onDomainEvent(e),
      record: (t) => this.record(t),
      onSellerMessage: (disputeId, message) => this.onSellerMessage(disputeId, message),
    });
    this.dispatcher = new Dispatcher({
      scheduler: this.scheduler,
      clock: this.clock,
      signer,
      webhookUrl: scenario.app.webhookUrl,
      webhookId: scenario.app.webhookId,
      runId: this.id,
      record: (t) => this.record(t),
      verifyCalls: this.ledger,
    });
  }

  now(): Date {
    return this.clock.now();
  }

  record(t: TraceEntry): void {
    this.trace.push(t);
    if (t.kind === 'delivery') this.scheduleCheckpoint(t.at);
    for (const listener of this.listeners) listener(t);
  }

  onTrace(listener: (t: TraceEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFinish(listener: () => void): () => void {
    this.finishListeners.add(listener);
    return () => this.finishListeners.delete(listener);
  }

  /** Called by the server for every `POST /v1/billing/subscriptions` it receives, on arrival. */
  noteSubscriptionCreate(): void {
    this.subscriptionCreates += 1;
  }

  subscriptions(): { customer: string; subscriptionId: string }[] {
    return this.book.subscriptions();
  }

  /** Subscribes every customer, approves them at the scenario start and delivers the first events. */
  async start(): Promise<void> {
    const { scenario, engine } = this;
    engine.usePlan(scenario.plan);
    for (const customer of scenario.customers) {
      const id = scenario.app.subscribeUrl
        ? await this.subscribeThroughApp(customer, scenario.app.subscribeUrl)
        : String(engine.createSubscription({ plan_id: 'P-FASTFORWARD', custom_id: customer.name, subscriber: { email_address: customer.email } }).id);
      this.book.link(customer, id);
    }
    for (const { subscriptionId } of this.subscriptions()) engine.approve(subscriptionId);
    for (const customer of scenario.customers) {
      for (const action of customer.actions) this.scheduleAction(customer, action);
    }
    this.scheduleForged();
    await this.serial(() => this.scheduler.advanceTo(this.clock.now()));
  }

  /** `weather.forged` notices at random moments of the run, signed so that verification fails. */
  private scheduleForged(): void {
    const { forged } = this.weather;
    const subscriptionIds = this.subscriptions().map((s) => s.subscriptionId);
    if (forged <= 0 || subscriptionIds.length === 0) return;
    const startMs = this.clock.now().getTime();
    const span = this.end.getTime() - startMs;
    const times = Array.from({ length: forged }, () => new Date(startMs + Math.floor(this.rng() * span)));
    forgedEvents(subscriptionIds, forged, this.rng, (i) => times[i]!).forEach((event, i) => this.dispatcher.scheduleSend(event, times[i]!, { forged: true }));
  }

  /** Moves virtual time forward to `to` (clamped to the run's end), delivering everything due. */
  advance(to: Date): Promise<void> {
    return this.serial(async () => {
      if (this.finished) throw new Error('the run has finished');
      await this.scheduler.advanceTo(to.getTime() > this.end.getTime() ? this.end : to);
    });
  }

  /** Plays the rest of the scenario, takes the final checkpoint and tells listeners the run is over. */
  runToEnd(): Promise<void> {
    return this.serial(async () => {
      if (this.finished) return;
      await this.scheduler.advanceTo(this.end);
      await this.checkpoint();
      this.finished = true;
      for (const listener of this.finishListeners) listener();
    });
  }

  /** One advance at a time: the scheduler is not re-entrant, and control requests can overlap. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async subscribeThroughApp(customer: Customer, url: string): Promise<string> {
    const before = this.subscriptionCreates;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: customer.name, email: customer.email }),
        signal: AbortSignal.timeout(SUBSCRIBE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`can't reach your app's subscribe endpoint at ${url}: ${(err as Error).message}. Is the app running, and is app.subscribeUrl right? Remove subscribeUrl from the scenario to let the simulator create subscriptions itself.`);
    }
    const text = await res.text();
    // Checked before the status: an app talking to the real sandbox usually fails too, and this is the real cause.
    if (this.subscriptionCreates === before) throw new Error(NOT_REDIRECTED);
    if (!res.ok) throw new Error(`subscribe for ${customer.name} answered ${res.status}: ${text.slice(0, 200)}. Your app's subscribe endpoint failed; look at your app's own log for the cause.`);
    let id: unknown;
    try {
      id = (JSON.parse(text) as { subscription_id?: unknown }).subscription_id;
    } catch {
      id = undefined;
    }
    if (typeof id !== 'string') throw new Error(`subscribe for ${customer.name} must answer {"subscription_id": "I-..."}, got: ${text.slice(0, 200)}`);
    try {
      this.engine.get(id);
    } catch {
      throw new Error(`your app answered subscription_id ${id} for ${customer.name}, but the simulator never created it. Your app must create the subscription through PayPal's API, started with fastforward-register so the call reaches the simulator, and return that id.`);
    }
    return id;
  }

  private onDomainEvent(e: DomainEvent): void {
    const now = this.clock.now();
    // Queued at the current instant rather than sent inline: the engine may be inside an app's request.
    this.send(toWebhookEvent(e, now), now);
    if (e.type !== 'BILLING.SUBSCRIPTION.PAYMENT.FAILED' || !this.deps.decide) return;
    const subscriptionId = String(e.resource.id);
    const customer = this.book.customerOf(subscriptionId);
    if (!customer) return;
    const n = this.book.noteFailure(subscriptionId);
    this.scheduler.schedule(now, `decide ${customer.name}`, () => this.decideAfterFailure(customer, subscriptionId, n, now));
  }

  private get calm(): boolean {
    const w = this.weather;
    return w.duplicates <= 0 && w.reorder <= 0 && w.delayMinutes[1] <= 0 && !w.burst;
  }

  /**
   * Sends an event now (calm weather), or collects it with everything else emitted at this virtual
   * instant and lets the weather plan the whole batch (delays, burst, reordering, duplicates).
   */
  private send(event: WebhookEvent, now: Date): void {
    if (this.calm) {
      this.dispatcher.scheduleSend(event, now);
      return;
    }
    this.batch.push({ event, at: now });
    if (this.flushQueued) return;
    this.flushQueued = true;
    // Queued behind the jobs already waiting at this instant, so the batch holds the whole cascade.
    this.scheduler.schedule(now, 'weather', async () => {
      this.flushQueued = false;
      const batch = this.batch;
      this.batch = [];
      for (const p of planDeliveries(batch, this.weather, this.rng)) this.dispatcher.scheduleSend(p.event, p.at, { forged: p.forged });
    });
  }

  private async decideAfterFailure(customer: Customer, subscriptionId: string, n: number, at: Date): Promise<void> {
    const { plan } = this.scenario;
    let decision: CustomerDecision;
    try {
      decision = await this.deps.decide!({
        key: `${customer.name}:payment_failed:${n}`,
        customer,
        point: 'payment_failed',
        at: at.toISOString(),
        details: `Your ${plan.price} ${plan.currency} payment for "${plan.name}" was declined (failure ${n}).`,
      });
    } catch {
      return; // a broken decide function must not stop the run; the customer simply does nothing
    }
    this.record({ at: at.toISOString(), kind: 'customer_decision', customer: customer.name, decision });
    if (decision.action === 'update_card') this.book.updateCard(subscriptionId);
    else if (decision.action === 'cancel') this.cancel(subscriptionId);
    else if (decision.action === 'dispute') this.openDispute(subscriptionId, decision.reason, decision.message);
    // 'ignore' and 'reply' change nothing here.
  }

  private scheduleAction(customer: Customer, action: CustomerAction): void {
    const subscriptionId = this.subscriptions().find((s) => s.customer === customer.name)!.subscriptionId;
    const at = new Date(Math.max(Date.parse(action.at), this.clock.now().getTime()));
    this.scheduler.schedule(at, `${customer.name} ${action.do}`, async () => {
      if (action.do === 'cancel') this.cancel(subscriptionId);
      else if (action.do === 'update_card') this.book.updateCard(subscriptionId);
      else this.openDispute(subscriptionId, action.reason, action.message ?? 'I am disputing this charge.');
    });
  }

  /** A customer disputes their latest sale. With no payment yet there is nothing to dispute, so nothing happens. */
  private openDispute(subscriptionId: string, reason: Parameters<DisputeEngine['open']>[3], message: string): void {
    const saleId = this.engine.latestSaleId(subscriptionId);
    const amount = (this.engine.get(subscriptionId).billing_info as { last_payment?: { amount: Money } } | undefined)?.last_payment?.amount;
    if (saleId && amount) this.disputes.open(subscriptionId, saleId, amount, reason, message);
  }

  /** The app wrote to a dispute: ask the customer how to answer, at the same virtual instant. */
  private onSellerMessage(disputeId: string, message: string): void {
    if (!this.deps.decide) return;
    const subscriptionId = this.disputes.subscriptionOf(disputeId);
    const customer = this.book.customerOf(subscriptionId);
    if (!customer) return;
    const n = this.book.noteSellerMessage(subscriptionId);
    const now = this.clock.now();
    this.scheduler.schedule(now, `reply ${customer.name}`, () => this.decideAfterMessage(customer, subscriptionId, disputeId, message, n, now));
  }

  private async decideAfterMessage(customer: Customer, subscriptionId: string, disputeId: string, message: string, n: number, at: Date): Promise<void> {
    let decision: CustomerDecision;
    try {
      decision = await this.deps.decide!({
        key: `${customer.name}:seller_message:${n}`,
        customer,
        point: 'seller_message',
        at: at.toISOString(),
        details: `The seller wrote to you about your dispute ${disputeId}: "${message}"`,
      });
    } catch {
      return; // a broken decide function must not stop the run
    }
    this.record({ at: at.toISOString(), kind: 'customer_decision', customer: customer.name, decision });
    if (decision.action === 'reply') {
      try {
        this.disputes.reply(disputeId, decision.message);
      } catch (err) {
        if (!(err instanceof PayPalError)) throw err; // the dispute was resolved in the meantime
      }
    } else if (decision.action === 'cancel') this.cancel(subscriptionId);
    else if (decision.action === 'update_card') this.book.updateCard(subscriptionId);
  }

  private cancel(subscriptionId: string): void {
    try {
      this.engine.cancel(subscriptionId, 'Cancelled by the customer');
    } catch (err) {
      if (!(err instanceof PayPalError)) throw err; // already cancelled or expired: nothing to do
    }
  }

  /** A probe closes each virtual day that had a delivery, at its last millisecond (spec §7). */
  private scheduleCheckpoint(atIso: string): void {
    if (!this.scenario.app.probeUrl) return;
    const day = atIso.slice(0, 10);
    if (this.checkpointDays.has(day)) return;
    this.checkpointDays.add(day);
    const at = new Date(Date.parse(`${day}T00:00:00.000Z`) + DAY_MS - 1);
    if (at.getTime() >= this.end.getTime()) return; // the end-of-run checkpoint covers it
    this.scheduler.schedule(at, `checkpoint ${day}`, () => this.checkpoint());
  }

  private async checkpoint(): Promise<void> {
    const probeUrl = this.scenario.app.probeUrl;
    if (!probeUrl) return;
    const at = this.clock.now().toISOString();
    const subs = this.subscriptions();
    const answers = await Promise.all(subs.map((s) => probe(probeUrl, s.subscriptionId)));
    subs.forEach(({ subscriptionId }, i) => {
      const status = this.engine.get(subscriptionId).status as SubscriptionStatus;
      this.record({
        at,
        kind: 'probe',
        subscriptionId,
        access: answers[i]!.access,
        fulfilments: answers[i]!.fulfilments,
        expectedAccess: this.scenario.expect.accessWhile.includes(status),
        completedPayments: this.engine.completedPayments(subscriptionId),
      });
    });
  }
}
