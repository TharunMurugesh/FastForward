import type { Customer, CustomerDecision, DecisionBy } from '@fastforward/contracts';
import { MODEL, stripCodeFence, type AiClient } from './client.js';
import { DecisionSchema, type DecisionLock } from './lock.js';
import { CUSTOMER_SYSTEM } from './prompts.js';

export interface DecisionContext {
  /** Lock key, `<customer>:<point>:<n>`. */
  key: string;
  customer: Customer;
  point: 'payment_failed' | 'seller_message';
  at: string;
  /** What just happened, in words (for example the seller's message). */
  details: string;
}

function scripted(point: DecisionContext['point']): CustomerDecision {
  return point === 'payment_failed' ? { action: 'ignore' } : { action: 'reply', message: 'I still have not received anything.' };
}

/**
 * Lock hit: return it. Otherwise ask the model; no model, a failure or junk output gives the scripted
 * default. Only real model decisions are saved, so a scripted fallback during an outage does not stick
 * to the lock and block the model's decision on the next run. `by` says which of the two decided.
 */
export async function decideWithSource(ctx: DecisionContext, ai: AiClient | null, lock: DecisionLock): Promise<{ decision: CustomerDecision; by: DecisionBy }> {
  const saved = lock.get(ctx.key);
  if (saved) return { decision: saved, by: 'model' };
  if (!ai) return { decision: scripted(ctx.point), by: 'scripted' };

  try {
    const reply = await ai.complete({ model: MODEL, system: CUSTOMER_SYSTEM, prompt: describe(ctx), json: true, effort: 'low' });
    const parsed = DecisionSchema.safeParse(JSON.parse(stripCodeFence(reply)));
    if (!parsed.success) return { decision: scripted(ctx.point), by: 'scripted' };
    lock.set(ctx.key, parsed.data);
    return { decision: parsed.data, by: 'model' };
  } catch {
    return { decision: scripted(ctx.point), by: 'scripted' };
  }
}

/** The decision alone; see decideWithSource. */
export async function decideCustomerAction(ctx: DecisionContext, ai: AiClient | null, lock: DecisionLock): Promise<CustomerDecision> {
  return (await decideWithSource(ctx, ai, lock)).decision;
}

function describe(ctx: DecisionContext): string {
  const when = ctx.point === 'payment_failed' ? 'Your card payment just failed.' : 'The seller has sent you a message about your dispute.';
  return `Customer: ${ctx.customer.name}\nPersona: ${ctx.customer.persona || '(none given)'}\nDate: ${ctx.at}\n${when}\n${ctx.details}`;
}
