import { describe, expect, it } from 'vitest';
import { describeAi, explanationLabel, type AiSummary } from '../src/index.js';

const base: AiSummary = {
  model: 'claude-opus-5-5',
  customerDecisions: { model: 2, total: 3 },
  explanations: { model: 4, total: 4 },
};

describe('describeAi', () => {
  it('says how much the model did, and that a run with no live calls was replayed from a recording', () => {
    expect(describeAi(base)).toBe('claude-opus-5-5 wrote 2 of 3 customer decisions and 4 of 4 explanations (no model calls now, replayed from a recording)');
    expect(describeAi({ ...base, calls: 0, inputTokens: 0, outputTokens: 0 })).toContain('replayed from a recording');
  });

  it('says how many live calls and tokens a run used', () => {
    expect(describeAi({ ...base, calls: 9, inputTokens: 5000, outputTokens: 1200 })).toBe(
      'claude-opus-5-5 wrote 2 of 3 customer decisions and 4 of 4 explanations (9 model calls, 6,200 tokens)',
    );
    expect(describeAi({ ...base, calls: 1 })).toContain('1 model call, 0 tokens');
  });
});

describe('explanationLabel', () => {
  it('names who wrote the text, or nothing when it is not known', () => {
    expect(explanationLabel('model')).toBe('Written by Claude');
    expect(explanationLabel('template')).toBe('Built-in text');
    expect(explanationLabel(undefined)).toBeNull();
  });
});
