import { describeAi as shared, explanationLabel as sharedLabel, type AiSummary } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { describeAi, explanationLabel } from '../src/format.js';

// The dashboard keeps its own copies so the browser bundle needs only types from the contracts package (a runtime import
// would pull in the scenario parser and its libraries). This test fails if the copies drift from the shared wording.
const summaries: AiSummary[] = [
  { model: 'claude-opus-5-5', customerDecisions: { model: 2, total: 3 }, explanations: { model: 4, total: 4 } },
  { model: 'claude-opus-5-5', customerDecisions: { model: 0, total: 0 }, explanations: { model: 1, total: 2 }, calls: 0, inputTokens: 0, outputTokens: 0 },
  { model: 'claude-opus-5-5', customerDecisions: { model: 5, total: 5 }, explanations: { model: 9, total: 9 }, calls: 1, inputTokens: 5000, outputTokens: 1200 },
  { model: 'claude-opus-5-5', customerDecisions: { model: 5, total: 5 }, explanations: { model: 9, total: 9 }, calls: 14, inputTokens: 123456, outputTokens: 7890 },
];

describe('the dashboard wording matches the shared wording', () => {
  it.each(summaries.map((s, i) => [i, s] as const))('describeAi, case %i', (_i, summary) => {
    expect(describeAi(summary)).toBe(shared(summary));
  });

  it('explanationLabel', () => {
    for (const source of ['model', 'template', undefined] as const) expect(explanationLabel(source)).toBe(sharedLabel(source));
  });
});
