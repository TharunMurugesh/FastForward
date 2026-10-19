import type { Customer } from '@fastforward/contracts';

interface CustomerState {
  customer: Customer;
  cardUpdated: boolean;
  failures: number;
}

/** Which scenario customer owns which subscription, and what their card does. */
export class CustomerBook {
  private readonly bySubscription = new Map<string, CustomerState>();
  private readonly order: { customer: string; subscriptionId: string }[] = [];

  link(customer: Customer, subscriptionId: string): void {
    if (this.bySubscription.has(subscriptionId)) {
      throw new Error(`your app answered subscription_id ${subscriptionId} for two customers; each subscribe must create a new subscription`);
    }
    this.bySubscription.set(subscriptionId, { customer, cardUpdated: false, failures: 0 });
    this.order.push({ customer: customer.name, subscriptionId });
  }

  subscriptions(): { customer: string; subscriptionId: string }[] {
    return this.order.map((s) => ({ ...s }));
  }

  customerOf(subscriptionId: string): Customer | undefined {
    return this.bySubscription.get(subscriptionId)?.customer;
  }

  /** `fails_from` fails every charge from that UTC date on, until the customer updates their card. */
  cardOutcome(subscriptionId: string, at: Date): 'ok' | 'fail' {
    const state = this.bySubscription.get(subscriptionId);
    if (!state || state.cardUpdated || state.customer.card.kind === 'ok') return 'ok';
    return at.getTime() >= Date.parse(`${state.customer.card.date}T00:00:00.000Z`) ? 'fail' : 'ok';
  }

  updateCard(subscriptionId: string): void {
    const state = this.bySubscription.get(subscriptionId);
    if (state) state.cardUpdated = true;
  }

  /** Counts a failed payment and returns its number for this customer (1, 2, …), for decision lock keys. */
  noteFailure(subscriptionId: string): number {
    const state = this.bySubscription.get(subscriptionId);
    if (!state) return 0;
    state.failures += 1;
    return state.failures;
  }
}
