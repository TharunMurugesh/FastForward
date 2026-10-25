import type { Report } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { groupKnownDiffs, runSummary } from '../src/format.js';

const report = (over: Partial<Report> = {}): Report => ({
  runId: 'run-1',
  scenario: 'bad-month',
  start: '2026-11-01T00:00:00.000Z',
  end: '2027-01-15T00:00:00.000Z',
  checks: [],
  counts: { events: 20, deliveries: 24, customers: 3 },
  ...over,
});

describe('runSummary', () => {
  it('says what was played in one line: scenario, length in days, customers, notices and deliveries', () => {
    expect(runSummary(report())).toBe('bad-month · 75 simulated days · 3 customers · 20 notices · 24 deliveries');
  });

  it('uses the singular for one of anything', () => {
    expect(runSummary(report({ end: '2026-11-02T00:00:00.000Z', counts: { events: 1, deliveries: 1, customers: 1 } }))).toBe(
      'bad-month · 1 simulated day · 1 customer · 1 notice · 1 delivery',
    );
  });
});

describe('groupKnownDiffs', () => {
  it('lists each reason once, with every field it covers, so one row cannot repeat the same paragraph four times', () => {
    const reason = 'The sandbox lists the payment later.';
    expect(
      groupKnownDiffs([
        { field: 'links', reason },
        { field: 'total_items', reason },
        { field: 'transactions', reason },
        { field: 'quantity', reason: 'Another reason.' },
      ]),
    ).toEqual([
      { fields: ['links', 'total_items', 'transactions'], reason },
      { fields: ['quantity'], reason: 'Another reason.' },
    ]);
  });

  it('is empty for no differences', () => {
    expect(groupKnownDiffs([])).toEqual([]);
  });
});
