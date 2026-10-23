import type { CheckId, Finding, TraceEntry } from '@fastforward/contracts';
import { MODEL, stripCodeFence, type AiClient } from './client.js';
import { CHECK_DESCRIPTIONS, NARRATOR_SYSTEM, TEMPLATES } from './prompts.js';
import { narrationKey, type NarrationLock } from './narration-lock.js';
import { z } from 'zod';

const MAX_EXCERPT = 20;

const NarrationSchema = z.object({ explanation: z.string().min(1), fix: z.string().min(1) });

/** The trace entries that mention the finding's events, so the model sees the evidence and not the whole run. */
function excerpt(finding: Finding, trace: TraceEntry[]): TraceEntry[] {
  const ids = new Set(finding.eventIds);
  const related = trace.filter((t) => {
    if (t.kind === 'event') return ids.has(t.event.id);
    if (t.kind === 'delivery') return ids.has(t.eventId);
    return false;
  });
  return related.slice(0, MAX_EXCERPT);
}

/**
 * Plain-language explanation and fix, and who wrote it. A saved explanation is replayed first (with no model call), then
 * the model, and only then the template for that check. Only real model output is saved.
 */
export async function explain(
  check: CheckId,
  finding: Finding,
  trace: TraceEntry[],
  ai: AiClient | null,
  lock?: NarrationLock,
): Promise<{ explanation: string; fix: string; source: 'model' | 'template' }> {
  const key = narrationKey(check, finding);
  const saved = lock?.get(key);
  if (saved) return { ...saved, source: 'model' };

  const template = { ...TEMPLATES[check], source: 'template' as const };
  if (!ai) return template;

  const prompt = [
    `Check: ${check}. ${CHECK_DESCRIPTIONS[check]}`,
    `Finding at ${finding.at}: ${finding.summary}`,
    `Trace excerpt:\n${JSON.stringify(excerpt(finding, trace), null, 2)}`,
  ].join('\n\n');

  try {
    const reply = await ai.complete({ model: MODEL, system: NARRATOR_SYSTEM, prompt, json: true, effort: 'medium' });
    const parsed = NarrationSchema.safeParse(JSON.parse(stripCodeFence(reply)));
    if (!parsed.success) return template;
    lock?.set(key, parsed.data);
    return { ...parsed.data, source: 'model' };
  } catch {
    return template;
  }
}

/** Plain-language explanation and fix. No AI, a failure or junk output gives the template for that check. */
export async function narrate(
  check: CheckId,
  finding: Finding,
  trace: TraceEntry[],
  ai: AiClient | null,
): Promise<{ explanation: string; fix: string }> {
  const { explanation, fix } = await explain(check, finding, trace, ai);
  return { explanation, fix };
}
