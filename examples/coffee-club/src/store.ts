export interface Member {
  subscriptionId: string;
  email: string;
  access: boolean;
  fulfilments: number;
}

/** In-memory state: who is subscribed, what they can use, which events were already handled. */
export class Store {
  private readonly members = new Map<string, Member>();
  private readonly seenEvents = new Set<string>();

  member(subscriptionId: string, email = ''): Member {
    let m = this.members.get(subscriptionId);
    if (!m) {
      m = { subscriptionId, email, access: false, fulfilments: 0 };
      this.members.set(subscriptionId, m);
    }
    return m;
  }

  find(subscriptionId: string): Member | undefined {
    return this.members.get(subscriptionId);
  }

  /** Returns true the first time an event id is seen. */
  firstSight(eventId: string): boolean {
    if (this.seenEvents.has(eventId)) return false;
    this.seenEvents.add(eventId);
    return true;
  }
}
