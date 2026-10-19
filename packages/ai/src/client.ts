import Anthropic from '@anthropic-ai/sdk';

/** One model for all three jobs (one prompt cache); depth is tuned per job with `effort`. */
export const MODEL = 'claude-opus-5-5';

export type Effort = 'low' | 'medium' | 'high';

export interface AiClient {
  complete(opts: { model: string; system: string; prompt: string; json?: boolean; effort?: Effort }): Promise<string>;
}

/** Thrown when a job needs the model and there is none (no key, FF_AI=off) or it cannot be reached. */
export class AiUnavailableError extends Error {
  override name = 'AiUnavailableError';
}

const JSON_ONLY = '\n\nReply with one JSON object and nothing else: no prose, no markdown fences.';

/** Removes a surrounding ``` fence, which models add even when told not to. */
export function stripCodeFence(text: string): string {
  const match = /^\s*```[a-zA-Z]*\n([\s\S]*?)\n?```\s*$/.exec(text);
  return (match?.[1] ?? text).trim();
}

/**
 * The real client. Thinking is always on for this model, so there is no `thinking` setting; `effort` is
 * the only depth control. `fallbacks: 'default'` lets the API re-run a request the safety classifiers
 * declined on the model Anthropic recommends instead of returning the refusal.
 * `sdk` is injectable so tests never touch the network.
 */
export function anthropicClient(apiKey: string, sdk: Anthropic = new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 })): AiClient {
  return {
    async complete({ model, system, prompt, json, effort }) {
      const response = await sdk.beta.messages.create({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: effort ?? 'medium' },
        system: json ? system + JSON_ONLY : system,
        messages: [{ role: 'user', content: prompt }],
      });
      if (response.stop_reason === 'refusal') {
        throw new Error(`the model declined this request (${response.stop_details?.category ?? 'no category given'})`);
      }
      if (response.stop_reason === 'max_tokens') throw new Error('the model ran out of room before finishing');
      const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
      if (!text.trim()) throw new Error('the model returned no text');
      return text;
    },
  };
}

/** null when `FF_AI=off` or there is no key: every job then uses its offline fallback. */
export function aiFromEnv(env: NodeJS.ProcessEnv = process.env): AiClient | null {
  if (env.FF_AI === 'off') return null;
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key ? anthropicClient(key) : null;
}
