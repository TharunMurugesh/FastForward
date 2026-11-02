import type { TraceEntry } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { watchFeed } from '../src/watch.js';

const notice = (eventId: string, at: string, failed = false) => ({ eventId, at, customer: 'Leo', eventType: 'BILLING.SUBSCRIPTION.SUSPENDED', failedChecks: failed ? ['FULFIL_ONCE'] : [] });
const decision = (at: string, by?: 'model' | 'scripted'): TraceEntry => ({ at, kind: 'customer_decision', customer: 'Leo', decision: { action: 'update_card' }, ...(by ? { by } : {}) });

describe('watchFeed', () => {
  it('puts the newest first and mixes in what customers chose', () => {
    const feed = watchFeed([notice('A', '2026-11-01T00:00:00Z'), notice('B', '2026-12-01T00:00:00Z')], [decision('2026-11-15T00:00:00Z', 'model')]);
    expect(feed.map((f) => f.title)).toEqual(['Subscription suspended', 'Leo chose to update their card', 'Subscription suspended']);
  });

  it('gives a notice delivered twice two different keys', () => {
    const feed = watchFeed([notice('A', '2026-11-01T00:00:00Z'), notice('A', '2026-11-01T01:00:00Z')], []);
    expect(new Set(feed.map((f) => f.key)).size).toBe(2);
  });

  it('does not credit Claude for a scripted default', () => {
    expect(watchFeed([], [decision('2026-11-15T00:00:00Z', 'scripted')])[0]!.detail).toBe('Scripted default');
    expect(watchFeed([], [decision('2026-11-15T00:00:00Z', 'model')])[0]!.detail).toBe('Decided by Claude');
  });

  it('marks a notice that failed a check, and ignores other trace entries', () => {
    const other: TraceEntry = { at: '2026-11-02T00:00:00Z', kind: 'app_call', method: 'GET', path: '/', status: 200 };
    const feed = watchFeed([notice('A', '2026-11-01T00:00:00Z', true)], [other]);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.failed).toBe(true);
  });
});
