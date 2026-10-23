import type { TraceEntry } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { badMonth } from '../src/fixtures/bad-month.js';
import { disputeThreads } from '../src/panels/thread.js';

const rows = badMonth.subscriptions.map((s) => ({ customer: s.customer, subscriptionId: s.subscriptionId }));
const reply = (message: string, by?: 'model' | 'scripted'): TraceEntry => ({
  at: '2026-11-25T00:00:00.000Z',
  kind: 'customer_decision',
  customer: 'Ana',
  decision: { action: 'reply', message },
  ...(by ? { by } : {}),
});

describe('dispute chat: who wrote a customer message', () => {
  const threadWith = (...extra: TraceEntry[]) => disputeThreads([...badMonth.trace, ...extra], rows).find((t) => t.customer === 'Ana')!;

  it('marks a reply the model decided, and leaves a scripted or unknown one unmarked', () => {
    const thread = threadWith(reply('Model words.', 'model'), reply('Scripted words.', 'scripted'), reply('Old trace, no marker.'));
    const byText = (text: string) => thread.messages.find((m) => m.text === text)!;
    expect(byText('Model words.')).toMatchObject({ from: 'buyer', byModel: true });
    expect(byText('Scripted words.').byModel).toBeUndefined();
    expect(byText('Old trace, no marker.').byModel).toBeUndefined();
  });
});
