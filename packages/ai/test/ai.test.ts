import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { CHECK_IDS, parseScenario, type Customer, type Finding, type TraceEntry } from '@fastforward/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiUnavailableError,
  DecisionLock,
  MODEL,
  aiFromEnv,
  anthropicClient,
  decideCustomerAction,
  narrate,
  writeScenario,
  type AiClient,
  type DecisionContext,
} from '../src/index.js';

type CompleteOpts = Parameters<AiClient['complete']>[0];

/** A fake AiClient that answers from a queue (a string is returned, an Error is thrown) and records calls. */
function fakeAi(...replies: (string | Error)[]) {
  const calls: CompleteOpts[] = [];
  const ai: AiClient = {
    async complete(opts) {
      calls.push(opts);
      const next = replies[Math.min(calls.length - 1, replies.length - 1)];
      if (next === undefined) throw new Error('fake AI has no reply');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { ai, calls };
}

const badMonth = readFileSync(new URL('../../../examples/coffee-club/scenarios/bad-month.yaml', import.meta.url), 'utf8');

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ff-ai-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeScenario', () => {
  it('parses model YAML into a Scenario', async () => {
    const { ai, calls } = fakeAi(badMonth);
    const scenario = await writeScenario('a rough two months for a coffee club', ai);
    expect(scenario.name).toBe('bad-month');
    expect(scenario.customers).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ model: MODEL, effort: 'medium' });
    expect(calls[0]?.prompt).toContain('a rough two months');
  });

  it('accepts YAML wrapped in a code fence', async () => {
    const { ai } = fakeAi('```yaml\n' + badMonth + '\n```');
    expect((await writeScenario('x', ai)).name).toBe('bad-month');
  });

  it('retries once on invalid YAML, showing the model its error, then succeeds', async () => {
    const { ai, calls } = fakeAi('name: broken', badMonth);
    const scenario = await writeScenario('x', ai);
    expect(scenario.name).toBe('bad-month');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.prompt).toContain('invalid scenario');
    expect(calls[1]?.prompt).toContain('name: broken');
  });

  it('retries once on invalid YAML then throws', async () => {
    const { ai, calls } = fakeAi('name: broken', 'still: not a scenario');
    await expect(writeScenario('x', ai)).rejects.toThrow(/two tries/);
    expect(calls).toHaveLength(2);
  });

  it('without AI throws AiUnavailableError', async () => {
    const err = await writeScenario('x', null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toContain('set ANTHROPIC_API_KEY or write the YAML by hand');
  });

  it('turns a failing model call into AiUnavailableError', async () => {
    const { ai } = fakeAi(new Error('503'));
    await expect(writeScenario('x', ai)).rejects.toBeInstanceOf(AiUnavailableError);
  });
});

const maya: Customer = { name: 'Maya', email: 'maya@example.test', persona: 'Pays on time.', card: { kind: 'ok' }, actions: [] };
const ctx = (over: Partial<DecisionContext> = {}): DecisionContext => ({
  key: 'Maya:payment_failed:1',
  customer: maya,
  point: 'payment_failed',
  at: '2026-12-01T00:00:00.000Z',
  details: 'Card declined.',
  ...over,
});

describe('decideCustomerAction', () => {
  it('comes from the lock without calling the AI', async () => {
    const lock = DecisionLock.load(join(dir, 'x.lock.json'));
    lock.set('Maya:payment_failed:1', { action: 'cancel' });
    const { ai, calls } = fakeAi('{"action":"ignore"}');
    expect(await decideCustomerAction(ctx(), ai, lock)).toEqual({ action: 'cancel' });
    expect(calls).toHaveLength(0);
  });

  it('asks the model at low effort and saves the decision', async () => {
    const lock = DecisionLock.load(join(dir, 'x.lock.json'));
    const { ai, calls } = fakeAi('{"action":"update_card"}');
    expect(await decideCustomerAction(ctx(), ai, lock)).toEqual({ action: 'update_card' });
    expect(calls[0]).toMatchObject({ model: MODEL, effort: 'low', json: true });
    expect(calls[0]?.prompt).toContain('Pays on time.');
    expect(lock.get('Maya:payment_failed:1')).toEqual({ action: 'update_card' });
  });

  it('AI failure falls back to the scripted decision', async () => {
    const lock = DecisionLock.load(join(dir, 'x.lock.json'));
    const { ai } = fakeAi(new Error('network down'));
    expect(await decideCustomerAction(ctx(), ai, lock)).toEqual({ action: 'ignore' });
    const seller = ctx({ key: 'Ana:seller_message:1', point: 'seller_message' });
    expect(await decideCustomerAction(seller, ai, lock)).toEqual({ action: 'reply', message: 'I still have not received anything.' });
  });

  it('no AI uses the scripted decision', async () => {
    const lock = DecisionLock.load(join(dir, 'x.lock.json'));
    expect(await decideCustomerAction(ctx(), null, lock)).toEqual({ action: 'ignore' });
  });

  it.each([
    ['not JSON', 'I would probably cancel.'],
    ['unknown action', '{"action":"explode"}'],
    ['dispute with an invented reason', '{"action":"dispute","reason":"BAD_VIBES","message":"hi"}'],
    ['reply without a message', '{"action":"reply"}'],
  ])('junk output (%s) falls back to the scripted decision and is not saved', async (_name, reply) => {
    const lock = DecisionLock.load(join(dir, 'x.lock.json'));
    const { ai } = fakeAi(reply);
    expect(await decideCustomerAction(ctx(), ai, lock)).toEqual({ action: 'ignore' });
    expect(lock.get('Maya:payment_failed:1')).toBeUndefined();
  });

  it('accepts a valid dispute decision inside a code fence', async () => {
    const lock = DecisionLock.load(join(dir, 'x.lock.json'));
    const reply = '```json\n{"action":"dispute","reason":"OTHER","message":"I was charged twice."}\n```';
    const { ai } = fakeAi(reply);
    expect(await decideCustomerAction(ctx(), ai, lock)).toEqual({ action: 'dispute', reason: 'OTHER', message: 'I was charged twice.' });
  });
});

describe('DecisionLock', () => {
  it('saves and reloads decisions', () => {
    const path = join(dir, 'nested', 's.lock.json');
    const lock = DecisionLock.load(path);
    lock.set('b', { action: 'ignore' });
    lock.set('a', { action: 'reply', message: 'hello' });
    lock.save();
    const again = DecisionLock.load(path);
    expect(again.get('a')).toEqual({ action: 'reply', message: 'hello' });
    expect(again.get('b')).toEqual({ action: 'ignore' });
    expect(Object.keys(JSON.parse(readFileSync(path, 'utf8')))).toEqual(['a', 'b']);
  });

  it('treats a missing file as empty', () => {
    expect(DecisionLock.load(join(dir, 'none.lock.json')).get('x')).toBeUndefined();
    expect(DecisionLock.load(join(dir, 'none.lock.json')).size).toBe(0);
  });

  it('refuses a damaged file instead of discarding it', () => {
    const path = join(dir, 'bad.lock.json');
    writeFileSync(path, '{not json');
    expect(() => DecisionLock.load(path)).toThrow(/--fresh/);
  });
});

const finding: Finding = { at: '2026-11-01T00:00:00.000Z', summary: 'Sale processed twice', eventIds: ['WH-1'] };
const trace: TraceEntry[] = [
  {
    at: '2026-11-01T00:00:00.000Z',
    kind: 'event',
    forged: false,
    event: { id: 'WH-1', event_version: '1.0', create_time: '2026-11-01T00:00:00.000Z', resource_type: 'sale', event_type: 'PAYMENT.SALE.COMPLETED', summary: 's', resource: {}, links: [] },
  },
  { at: '2026-11-01T00:00:01.000Z', kind: 'delivery', eventId: 'WH-1', attempt: 1, status: 200, ms: 12, verifyCalled: true, transmissionId: 'T-1' },
  { at: '2026-11-01T00:00:02.000Z', kind: 'delivery', eventId: 'WH-OTHER', attempt: 1, status: 200, ms: 5, verifyCalled: true, transmissionId: 'T-2' },
];

describe('narrate', () => {
  it('falls back to the template when the AI throws', async () => {
    const { ai } = fakeAi(new Error('boom'));
    const out = await narrate('FULFIL_ONCE', finding, trace, ai);
    expect(out.explanation).toContain('same notice twice');
    expect(out.fix.length).toBeGreaterThan(0);
  });

  it('has a template for every check, used when there is no AI', async () => {
    for (const id of CHECK_IDS) {
      const out = await narrate(id, finding, trace, null);
      expect(out.explanation.length).toBeGreaterThan(20);
      expect(out.fix.length).toBeGreaterThan(10);
    }
  });

  it('uses the model answer at medium effort and sends only the related trace entries', async () => {
    const { ai, calls } = fakeAi('{"explanation":"The same payment arrived twice.","fix":"Remember event ids."}');
    expect(await narrate('FULFIL_ONCE', finding, trace, ai)).toEqual({ explanation: 'The same payment arrived twice.', fix: 'Remember event ids.' });
    expect(calls[0]).toMatchObject({ model: MODEL, effort: 'medium', json: true });
    expect(calls[0]?.prompt).toContain('WH-1');
    expect(calls[0]?.prompt).not.toContain('WH-OTHER');
  });

  it('falls back to the template on junk output', async () => {
    const { ai } = fakeAi('{"explanation":"only half"}');
    const out = await narrate('ACK_FAST', finding, trace, ai);
    expect(out.explanation).toContain('took too long');
  });
});

describe('aiFromEnv', () => {
  it('returns null when FF_AI=off, even with a key', () => {
    expect(aiFromEnv({ FF_AI: 'off', ANTHROPIC_API_KEY: 'sk-test' })).toBeNull();
  });
  it('returns null without a key', () => {
    expect(aiFromEnv({})).toBeNull();
    expect(aiFromEnv({ ANTHROPIC_API_KEY: '  ' })).toBeNull();
  });
  it('returns a client with a key', () => {
    expect(aiFromEnv({ ANTHROPIC_API_KEY: 'sk-test' })).not.toBeNull();
  });
});

describe('anthropicClient (stubbed SDK, no network)', () => {
  function stubSdk(response: unknown) {
    const requests: Record<string, unknown>[] = [];
    const sdk = {
      beta: {
        messages: {
          create: async (req: Record<string, unknown>) => {
            requests.push(req);
            return response;
          },
        },
      },
    } as unknown as Anthropic;
    return { sdk, requests };
  }
  const reply = (over: Record<string, unknown> = {}) => ({
    stop_reason: 'end_turn',
    stop_details: null,
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }],
    ...over,
  });

  it('sends the model, effort, fallback opt-in and no thinking override; joins the text blocks', async () => {
    const { sdk, requests } = stubSdk(reply());
    const out = await anthropicClient('sk-test', sdk).complete({ model: MODEL, system: 'S', prompt: 'P', effort: 'low' });
    expect(out).toBe('hello world');
    const req = requests[0]!;
    expect(req).toMatchObject({
      model: 'claude-opus-5-5',
      output_config: { effort: 'low' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      messages: [{ role: 'user', content: 'P' }],
    });
    expect(req).not.toHaveProperty('thinking');
    expect(req).not.toHaveProperty('temperature');
  });

  it('asks for JSON only when json is set', async () => {
    const { sdk, requests } = stubSdk(reply());
    await anthropicClient('sk-test', sdk).complete({ model: MODEL, system: 'S', prompt: 'P', json: true });
    expect(String(requests[0]!.system)).toContain('one JSON object');
  });

  it('throws on a refusal instead of reading its content', async () => {
    const { sdk } = stubSdk(reply({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' }, content: [] }));
    await expect(anthropicClient('sk-test', sdk).complete({ model: MODEL, system: 'S', prompt: 'P' })).rejects.toThrow(/declined.*cyber/);
  });

  it('throws when the answer was cut off', async () => {
    const { sdk } = stubSdk(reply({ stop_reason: 'max_tokens' }));
    await expect(anthropicClient('sk-test', sdk).complete({ model: MODEL, system: 'S', prompt: 'P' })).rejects.toThrow(/ran out of room/);
  });

  it('a refusal makes decisions fall back to scripted ones', async () => {
    const { sdk } = stubSdk(reply({ stop_reason: 'refusal', content: [] }));
    const lock = DecisionLock.load(join(dir, 'r.lock.json'));
    expect(await decideCustomerAction(ctx(), anthropicClient('sk-test', sdk), lock)).toEqual({ action: 'ignore' });
  });
});

describe('bad-month.yaml stays valid for the writer prompt', () => {
  it('parses', () => {
    expect(parseScenario(badMonth).durationDays).toBe(60);
  });
});
