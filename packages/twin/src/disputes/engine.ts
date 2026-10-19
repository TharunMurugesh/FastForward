import type { DisputeAction, DisputeReason, TraceEntry } from '@fastforward/contracts';
import { fidelity } from '../fidelity.js';
import { newId } from '../ids.js';
import type { DomainEvent } from '../subscriptions/events.js';
import { PayPalError, type Money } from '../subscriptions/resources.js';
import type { VirtualClock } from '../time/clock.js';
import type { Scheduler } from '../time/scheduler.js';

export interface DisputeDeps {
  clock: VirtualClock;
  scheduler: Scheduler;
  emit: (e: DomainEvent) => void;
  record: (t: TraceEntry) => void;
  /**
   * Called after the seller posts a message, so the run can ask the customer how to answer (the
   * customer's reply comes back through `reply`).
   */
  onSellerMessage?: (disputeId: string, message: string) => void;
}

export type DisputeResource = Record<string, unknown>;

interface Message {
  posted_by: 'BUYER' | 'SELLER';
  time_posted: string;
  content: string;
}

interface DisputeState {
  id: string;
  subscriptionId: string;
  saleId: string;
  amount: Money;
  reason: DisputeReason;
  status: 'WAITING_FOR_SELLER_RESPONSE' | 'WAITING_FOR_BUYER_RESPONSE' | 'UNDER_REVIEW' | 'RESOLVED';
  createTime: Date;
  updateTime: Date;
  dueDate: Date;
  messages: Message[];
  evidences: unknown[];
  offer?: Record<string, unknown>;
  outcome?: Record<string, unknown>;
  /** True once the seller has done anything; that stops the automatic buyer-favour resolution. */
  sellerActed: boolean;
}

const DAY_MS = 86_400_000;
const API = 'https://api.sandbox.paypal.com';

function stateError(id: string, description: string): PayPalError {
  return new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'The requested action could not be performed, semantically incorrect, or failed business validation.', [
    { issue: 'DISPUTE_NOT_IN_ALLOWED_STATE', description: `Dispute ${id}: ${description}` },
  ]);
}

/**
 * Disputes opened by customers (scenario actions) and answered by the app under test. The seller has
 * `fidelity.disputeResponseDays` to act; if they never do, the dispute is resolved in the buyer's favour
 * (unverified rule, spec §6). Owns no HTTP; it reports through `emit` and `record`.
 */
export class DisputeEngine {
  private readonly disputes = new Map<string, DisputeState>();

  constructor(private readonly deps: DisputeDeps) {}

  /** A customer opens a dispute against a sale. Returns the dispute id (`PP-D-12345`). */
  open(subscriptionId: string, saleId: string, amount: Money, reason: DisputeReason, message: string): string {
    const now = this.deps.clock.now();
    const dispute: DisputeState = {
      id: newId('PP-D'),
      subscriptionId,
      saleId,
      amount,
      reason,
      status: 'WAITING_FOR_SELLER_RESPONSE',
      createTime: now,
      updateTime: now,
      dueDate: new Date(now.getTime() + fidelity.disputeResponseDays * DAY_MS),
      messages: [{ posted_by: 'BUYER', time_posted: now.toISOString(), content: message }],
      evidences: [],
      sellerActed: false,
    };
    while (this.disputes.has(dispute.id)) dispute.id = newId('PP-D');
    this.disputes.set(dispute.id, dispute);
    this.emit('CUSTOMER.DISPUTE.CREATED', dispute);

    // One millisecond after the deadline, so an action on the due date itself still counts as in time.
    this.deps.scheduler.schedule(new Date(dispute.dueDate.getTime() + 1), `dispute deadline ${dispute.id}`, async () => {
      if (!dispute.sellerActed && dispute.status !== 'RESOLVED') this.resolveForBuyer(dispute);
    });
    return dispute.id;
  }

  /** The seller (the app under test) acts on a dispute. `body` is the request's JSON, or its multipart `input` part. */
  act(id: string, action: DisputeAction, body: unknown): void {
    const dispute = this.find(id);
    if (dispute.status === 'RESOLVED') throw stateError(id, 'it is already resolved.');
    const b = (typeof body === 'object' && body !== null ? body : {}) as Record<string, any>;
    const now = this.deps.clock.now();

    let message: string | undefined;
    switch (action) {
      case 'provide-evidence':
        if (Array.isArray(b.evidences)) dispute.evidences.push(...b.evidences);
        dispute.status = 'UNDER_REVIEW';
        break;
      case 'send-message':
        if (typeof b.message !== 'string' || b.message === '') {
          throw new PayPalError(422, 'UNPROCESSABLE_ENTITY', 'The requested action could not be performed, semantically incorrect, or failed business validation.', [
            { field: '/message', issue: 'MISSING_REQUIRED_PARAMETER', description: 'A required field is missing: message.' },
          ]);
        }
        message = b.message;
        dispute.messages.push({ posted_by: 'SELLER', time_posted: now.toISOString(), content: message });
        dispute.status = 'WAITING_FOR_BUYER_RESPONSE';
        break;
      case 'make-offer':
        dispute.offer = {
          buyer_requested_amount: dispute.amount,
          ...(b.offer_amount ? { seller_offered_amount: b.offer_amount } : {}),
          ...(typeof b.offer_type === 'string' ? { offer_type: b.offer_type } : {}),
        };
        dispute.status = 'WAITING_FOR_BUYER_RESPONSE';
        break;
      case 'accept-claim':
        break; // resolved below
    }
    dispute.sellerActed = true;
    dispute.updateTime = now;
    this.deps.record({ at: now.toISOString(), kind: 'dispute_action', disputeId: id, action });
    this.emit('CUSTOMER.DISPUTE.UPDATED', dispute);

    if (action === 'accept-claim') this.resolveForBuyer(dispute);
    if (message !== undefined) this.deps.onSellerMessage?.(id, message);
  }

  /** The customer answers a seller message; the dispute goes back to the seller. Not a seller action. */
  reply(id: string, message: string): void {
    const dispute = this.find(id);
    if (dispute.status === 'RESOLVED') throw stateError(id, 'it is already resolved.');
    const now = this.deps.clock.now();
    dispute.messages.push({ posted_by: 'BUYER', time_posted: now.toISOString(), content: message });
    dispute.status = 'WAITING_FOR_SELLER_RESPONSE';
    dispute.updateTime = now;
    this.emit('CUSTOMER.DISPUTE.UPDATED', dispute);
  }

  get(id: string): DisputeResource {
    return this.resource(this.find(id));
  }

  list(): DisputeResource[] {
    return [...this.disputes.values()].map((d) => this.resource(d));
  }

  /** Which subscription a dispute is about (for the run's bookkeeping). */
  subscriptionOf(id: string): string {
    return this.find(id).subscriptionId;
  }

  private resolveForBuyer(dispute: DisputeState): void {
    dispute.status = 'RESOLVED';
    dispute.updateTime = this.deps.clock.now();
    dispute.outcome = { outcome_code: 'RESOLVED_BUYER_FAVOUR', amount_refunded: dispute.amount };
    this.emit('CUSTOMER.DISPUTE.RESOLVED', dispute);
  }

  private find(id: string): DisputeState {
    const dispute = this.disputes.get(id);
    if (!dispute) {
      throw new PayPalError(404, 'RESOURCE_NOT_FOUND', 'The specified resource does not exist.', [
        { issue: 'INVALID_RESOURCE_ID', description: `Dispute ${id} does not exist.` },
      ]);
    }
    return dispute;
  }

  private emit(type: DomainEvent['type'], dispute: DisputeState): void {
    this.deps.emit({ type, resourceType: 'dispute', resource: this.resource(dispute) });
  }

  private resource(d: DisputeState): DisputeResource {
    return {
      dispute_id: d.id,
      create_time: d.createTime.toISOString(),
      update_time: d.updateTime.toISOString(),
      disputed_transactions: [
        { seller_transaction_id: d.saleId, transaction_status: 'COMPLETED', gross_amount: d.amount, custom: d.subscriptionId },
      ],
      reason: d.reason,
      status: d.status,
      dispute_amount: d.amount,
      ...(d.outcome ? { dispute_outcome: d.outcome } : {}),
      dispute_life_cycle_stage: 'INQUIRY',
      dispute_channel: 'INTERNAL',
      messages: d.messages,
      ...(d.evidences.length > 0 ? { evidences: d.evidences } : {}),
      seller_response_due_date: d.dueDate.toISOString(),
      ...(d.offer ? { offer: d.offer } : {}),
      links: [{ href: `${API}/v1/customer/disputes/${d.id}`, rel: 'self', method: 'GET' }],
    };
  }
}
