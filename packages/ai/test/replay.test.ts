import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { Finding, TraceEntry } from '@fastforward/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiUnavailableError,
  decideWithSource,
  DecisionLock,
  NarrationLock,
  anthropicClient,
  callLimitFromEnv,
  explain,
  narrationKey,
  withCallLimit,
  type AiClient,
} from '../src/index.js';

/** A fake AiClient that answers from a queue and records how often it was called. */
function fakeAi(...replies: (string | Error)[]) {
  let calls = 0;
  const ai: AiClient = {
    async complete() {
      const next = replies[Math.min(calls, replies.length - 1)];
      calls += 1;
      if (next === undefined) throw new Error('fake AI has no reply');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { ai, calls: () => calls };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-replay-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const finding = (summary: string, eventIds: string[] = ['WH-1']): Finding => ({ at: '2026-11-01T00:00:00.000Z', summary, eventIds });
const trace: TraceEntry[] = [];
const MODEL_REPLY = '{"explanation":"The same payment arrived twice.","fix":"Remember event ids."}';

describe('narrationKey', () => {
  it('is the same across runs that differ only in generated ids', () => {
    const a = narrationKey('DISPUTE_ANSWERED', finding('Dispute PP-D-98478 opened on 2026-11-20 was not answered by 2026-12-10.'));
    const b = narrationKey('DISPUTE_ANSWERED', finding('Dispute PP-D-11111 opened on 2026-11-20 was not answered by 2026-12-10.'));
    expect(a).toBe(b);
  });

  it('differs for another check or other wording', () => {
    const f = finding('Maya was given what they paid for 2 times.');
    expect(narrationKey('FULFIL_ONCE', f)).not.toBe(narrationKey('STATE_MATCHES', f));
    expect(narrationKey('FULFIL_ONCE', f)).not.toBe(narrationKey('FULFIL_ONCE', finding('Ana was given what they paid for 2 times.')));
  });

  it('masks subscription and webhook ids too', () => {
    const a = narrationKey('VERIFIES_SIGNATURES', finding('The BILLING.SUBSCRIPTION.CREATED notice WH-S7ACO2ASBYMD1T6BP-2KM9T49HQCR6YGFQT for I-AB12CD34EF56 was acted on.'));
    const b = narrationKey('VERIFIES_SIGNATURES', finding('The BILLING.SUBSCRIPTION.CREATED notice WH-ZZZZZZZZZZZZZZZZZ-AAAAAAAAAAAAAAAAA for I-ZZ99YY88XX77 was acted on.'));
    expect(a).toBe(b);
  });
});

describe('NarrationLock', () => {
  it('saves and reloads explanations, sorted, and counts what a run used', () => {
    const path = join(dir, 'nested', 's.narration.lock.json');
    const lock = NarrationLock.load(path);
    lock.set('b', { explanation: 'two', fix: 'fix two' });
    lock.set('a', { explanation: 'one', fix: 'fix one' });
    lock.save();
    const again = NarrationLock.load(path);
    expect(again.touched).toBe(0);
    expect(again.get('a')).toEqual({ explanation: 'one', fix: 'fix one' });
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')))).toEqual(['a', 'b']);
    expect(again.touched).toBe(1);
  });

  it('treats a missing file as empty and refuses a damaged one', () => {
    expect(NarrationLock.load(join(dir, 'none.json')).size).toBe(0);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(() => NarrationLock.load(bad)).toThrow(/--fresh/);
  });
});

describe('explain', () => {
  it('replays a saved explanation with no model call, and says the model wrote it', async () => {
    const lock = NarrationLock.load(join(dir, 'n.json'));
    const f = finding('Sale processed twice');
    lock.set(narrationKey('FULFIL_ONCE', f), { explanation: 'Saved words.', fix: 'Saved fix.' });
    const { ai, calls } = fakeAi(MODEL_REPLY);
    expect(await explain('FULFIL_ONCE', f, trace, ai, lock)).toEqual({ explanation: 'Saved words.', fix: 'Saved fix.', source: 'model' });
    expect(calls()).toBe(0);
  });

  it('replays with no AI at all, which is how the hosted demo shows a recorded run', async () => {
    const lock = NarrationLock.load(join(dir, 'n.json'));
    const f = finding('Sale processed twice');
    lock.set(narrationKey('FULFIL_ONCE', f), { explanation: 'Saved words.', fix: 'Saved fix.' });
    expect((await explain('FULFIL_ONCE', f, trace, null, lock)).source).toBe('model');
  });

  it('asks the model once, saves the answer, and reuses it next time', async () => {
    const lock = NarrationLock.load(join(dir, 'n.json'));
    const f = finding('Sale processed twice');
    const { ai, calls } = fakeAi(MODEL_REPLY);
    const first = await explain('FULFIL_ONCE', f, trace, ai, lock);
    expect(first).toEqual({ explanation: 'The same payment arrived twice.', fix: 'Remember event ids.', source: 'model' });
    expect(await explain('FULFIL_ONCE', f, trace, ai, lock)).toEqual(first);
    expect(calls()).toBe(1);
  });

  it('falls back to the template, marked as a template, and does not save it', async () => {
    const lock = NarrationLock.load(join(dir, 'n.json'));
    const f = finding('Sale processed twice');
    const { ai } = fakeAi(new Error('503'));
    const out = await explain('FULFIL_ONCE', f, trace, ai, lock);
    expect(out.source).toBe('template');
    expect(out.explanation).toContain('same notice twice');
    expect(lock.size).toBe(0);
  });

  it('with no AI and nothing saved, uses the template', async () => {
    const out = await explain('ACK_FAST', finding('Slow'), trace, null, NarrationLock.load(join(dir, 'n.json')));
    expect(out.source).toBe('template');
  });

  it('works without a lock at all', async () => {
    const { ai } = fakeAi(MODEL_REPLY);
    expect((await explain('FULFIL_ONCE', finding('x'), trace, ai)).source).toBe('model');
  });
});

describe('DecisionLock.touched', () => {
  it('counts the decisions a run used, whether replayed or newly made', () => {
    const lock = DecisionLock.load(join(dir, 'd.json'));
    lock.set('a', { action: 'ignore' });
    lock.save();
    const again = DecisionLock.load(join(dir, 'd.json'));
    expect(again.touched).toBe(0);
    again.get('a');
    again.get('a'); // the same key twice is one decision
    again.set('b', { action: 'cancel' });
    again.get('missing');
    expect(again.touched).toBe(2);
  });
});

describe('the spend guard', () => {
  it('stops after the limit with an AiUnavailableError, so the offline fallbacks take over', async () => {
    const { ai, calls } = fakeAi('ok');
    const limited = withCallLimit(ai, 2);
    await limited.complete({ model: 'm', system: 's', prompt: 'p' });
    await limited.complete({ model: 'm', system: 's', prompt: 'p' });
    await expect(limited.complete({ model: 'm', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(AiUnavailableError);
    expect(calls()).toBe(2);
    expect(limited.usage?.().calls).toBe(2);
  });

  it('reads the limit from FF_AI_MAX_CALLS, 100 by default, and rejects nonsense', () => {
    expect(callLimitFromEnv({})).toBe(100);
    expect(callLimitFromEnv({ FF_AI_MAX_CALLS: '7' })).toBe(7);
    for (const bad of ['0', '-1', 'many', '2.5', '']) expect(() => callLimitFromEnv({ FF_AI_MAX_CALLS: bad }), bad).toThrow(/FF_AI_MAX_CALLS/);
  });

  it('counts tokens from the API usage, so a recording can be priced', async () => {
    const sdk = {
      beta: {
        messages: {
          create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 120, output_tokens: 30 } }),
        },
      },
    } as unknown as Anthropic;
    const client = anthropicClient('sk-test', sdk);
    await client.complete({ model: 'm', system: 's', prompt: 'p' });
    await client.complete({ model: 'm', system: 's', prompt: 'p' });
    expect(client.usage?.()).toEqual({ calls: 2, inputTokens: 240, outputTokens: 60 });
  });
});

describe('decideWithSource', () => {
  const maya = { name: 'Maya', email: 'maya@example.test', persona: 'Pays on time.', card: { kind: 'ok' as const }, actions: [] };
  const ctx = { key: 'Maya:payment_failed:1', customer: maya, point: 'payment_failed' as const, at: '2026-12-01T00:00:00.000Z', details: 'Card declined.' };

  it('says model for a recorded decision, a new model decision, and scripted for a fallback', async () => {
    const lock = DecisionLock.load(join(dir, 'd.json'));
    lock.set('Maya:payment_failed:1', { action: 'cancel' });
    expect(await decideWithSource(ctx, null, lock)).toEqual({ decision: { action: 'cancel' }, by: 'model' });

    const fresh = DecisionLock.load(join(dir, 'other.json'));
    const { ai } = fakeAi('{"action":"update_card"}');
    expect(await decideWithSource(ctx, ai, fresh)).toEqual({ decision: { action: 'update_card' }, by: 'model' });

    const empty = DecisionLock.load(join(dir, 'none.json'));
    expect(await decideWithSource(ctx, null, empty)).toEqual({ decision: { action: 'ignore' }, by: 'scripted' });
    const { ai: broken } = fakeAi(new Error('503'));
    expect(await decideWithSource(ctx, broken, empty)).toEqual({ decision: { action: 'ignore' }, by: 'scripted' });
  });
});
