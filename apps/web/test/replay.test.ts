import { describe, expect, it } from 'vitest';
import { badMonth } from '../src/fixtures/bad-month.js';
import { cutAt, type WholeRun } from '../src/useRun.js';

const run: WholeRun = { runId: badMonth.runId, end: badMonth.end, subscriptions: badMonth.subscriptions, trace: badMonth.trace, report: badMonth.report };

describe('cutAt (replaying a finished run)', () => {
  it('at the end, shows the whole run with the same verdict', () => {
    const v = cutAt(run, run.end);
    expect(v.trace).toHaveLength(run.trace.length);
    expect(v.report!.checks.map((c) => c.status)).toEqual(badMonth.report.checks.map((c) => c.status));
    expect(v.info.now).toBe(run.end);
  });

  it('on an earlier day, drops what had not happened yet and recounts', () => {
    const day = '2026-11-15T00:00:00.000Z';
    const v = cutAt(run, day);
    expect(v.trace.every((t) => Date.parse(t.at) <= Date.parse(day))).toBe(true);
    expect(v.trace.length).toBeLessThan(run.trace.length);
    expect(v.report!.counts.events).toBe(v.trace.filter((t) => t.kind === 'event').length);
    // The dispute is opened on 20 Nov, so on 15 Nov its check has nothing against it yet.
    expect(v.report!.checks.find((c) => c.id === 'DISPUTE_ANSWERED')!.status).toBe('pass');
  });

  it('keeps a skipped check skipped on any day', () => {
    const skipped: WholeRun = { ...run, report: { ...badMonth.report, checks: [{ id: 'NO_LIVE_CALLS', status: 'skipped', findings: [], note: 'n/a' }] } };
    expect(cutAt(skipped, run.end).report!.checks[0]!.status).toBe('skipped');
  });

  it('works for a run with no report yet', () => {
    expect(cutAt({ ...run, report: null }, run.end).report).toBeNull();
  });
});
