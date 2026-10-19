import { describe, expect, it } from 'vitest';
import { addInterval } from '../src/time/calendar.js';
import { VirtualClock } from '../src/time/clock.js';
import { Scheduler } from '../src/time/scheduler.js';

const d = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString();

describe('VirtualClock', () => {
  it('starts where told and moves only forward', () => {
    const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
    expect(iso(clock.now())).toBe('2026-11-01T00:00:00.000Z');
    clock.set(d('2026-11-02T00:00:00.000Z'));
    expect(iso(clock.now())).toBe('2026-11-02T00:00:00.000Z');
  });

  it('setting clock backwards throws', () => {
    const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
    expect(() => clock.set(d('2026-10-31T23:59:59.999Z'))).toThrow(/backwards/);
    expect(iso(clock.now())).toBe('2026-11-01T00:00:00.000Z');
  });

  it('setting the same time is allowed', () => {
    const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
    expect(() => clock.set(d('2026-11-01T00:00:00.000Z'))).not.toThrow();
  });

  it('now() returns a copy that cannot move the clock', () => {
    const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
    clock.now().setUTCFullYear(1999);
    expect(iso(clock.now())).toBe('2026-11-01T00:00:00.000Z');
  });

  it('rejects an invalid start', () => {
    expect(() => new VirtualClock('yesterday')).toThrow();
  });
});

describe('Scheduler', () => {
  const setup = () => {
    const clock = new VirtualClock('2026-11-01T00:00:00.000Z');
    return { clock, scheduler: new Scheduler(clock), log: [] as string[] };
  };

  it('runs jobs in time order', async () => {
    const { scheduler, log } = setup();
    scheduler.schedule(d('2026-11-03T00:00:00.000Z'), 'c', async () => void log.push('c'));
    scheduler.schedule(d('2026-11-01T12:00:00.000Z'), 'a', async () => void log.push('a'));
    scheduler.schedule(d('2026-11-02T00:00:00.000Z'), 'b', async () => void log.push('b'));
    expect(scheduler.pending()).toBe(3);
    const ran = await scheduler.advanceTo(d('2026-11-10T00:00:00.000Z'));
    expect(ran).toBe(3);
    expect(log).toEqual(['a', 'b', 'c']);
    expect(scheduler.pending()).toBe(0);
  });

  it('ties run in insertion order', async () => {
    const { scheduler, log } = setup();
    const at = d('2026-11-02T00:00:00.000Z');
    scheduler.schedule(at, 'first', async () => void log.push('first'));
    scheduler.schedule(d('2026-11-01T06:00:00.000Z'), 'earlier', async () => void log.push('earlier'));
    scheduler.schedule(at, 'second', async () => void log.push('second'));
    scheduler.schedule(at, 'third', async () => void log.push('third'));
    await scheduler.advanceTo(d('2026-11-05T00:00:00.000Z'));
    expect(log).toEqual(['earlier', 'first', 'second', 'third']);
  });

  it('sets the clock to each job time before running it', async () => {
    const { clock, scheduler } = setup();
    const seen: string[] = [];
    scheduler.schedule(d('2026-11-02T00:00:00.000Z'), 'a', async () => void seen.push(iso(clock.now())));
    scheduler.schedule(d('2026-11-04T00:00:00.000Z'), 'b', async () => void seen.push(iso(clock.now())));
    await scheduler.advanceTo(d('2026-11-09T00:00:00.000Z'));
    expect(seen).toEqual(['2026-11-02T00:00:00.000Z', '2026-11-04T00:00:00.000Z']);
  });

  it('job scheduled during advance runs if due', async () => {
    const { scheduler, log } = setup();
    scheduler.schedule(d('2026-11-02T00:00:00.000Z'), 'parent', async () => {
      log.push('parent');
      scheduler.schedule(d('2026-11-03T00:00:00.000Z'), 'child', async () => {
        log.push('child');
        scheduler.schedule(d('2026-11-20T00:00:00.000Z'), 'later', async () => void log.push('later'));
      });
    });
    const ran = await scheduler.advanceTo(d('2026-11-05T00:00:00.000Z'));
    expect(ran).toBe(2);
    expect(log).toEqual(['parent', 'child']);
    expect(scheduler.pending()).toBe(1);
  });

  it('a child scheduled for the current instant runs after its already-queued ties', async () => {
    const { scheduler, log } = setup();
    const at = d('2026-11-02T00:00:00.000Z');
    scheduler.schedule(at, 'parent', async () => {
      log.push('parent');
      scheduler.schedule(at, 'child', async () => void log.push('child'));
    });
    scheduler.schedule(at, 'sibling', async () => void log.push('sibling'));
    await scheduler.advanceTo(d('2026-11-03T00:00:00.000Z'));
    expect(log).toEqual(['parent', 'sibling', 'child']);
  });

  it('a job scheduled in the past runs at the current time, not earlier', async () => {
    const { clock, scheduler } = setup();
    clock.set(d('2026-11-05T00:00:00.000Z'));
    let seen = '';
    scheduler.schedule(d('2026-11-01T00:00:00.000Z'), 'late', async () => void (seen = iso(clock.now())));
    await scheduler.advanceTo(d('2026-11-06T00:00:00.000Z'));
    expect(seen).toBe('2026-11-05T00:00:00.000Z');
  });

  it('advanceTo leaves clock at target', async () => {
    const { clock, scheduler } = setup();
    scheduler.schedule(d('2026-11-02T00:00:00.000Z'), 'a', async () => {});
    scheduler.schedule(d('2026-12-25T00:00:00.000Z'), 'beyond', async () => {});
    const ran = await scheduler.advanceTo(d('2026-11-10T00:00:00.000Z'));
    expect(ran).toBe(1);
    expect(iso(clock.now())).toBe('2026-11-10T00:00:00.000Z');
    expect(scheduler.pending()).toBe(1);
  });

  it('a job due exactly at the target runs', async () => {
    const { scheduler, log } = setup();
    const target = d('2026-11-10T00:00:00.000Z');
    scheduler.schedule(target, 'edge', async () => void log.push('edge'));
    expect(await scheduler.advanceTo(target)).toBe(1);
    expect(log).toEqual(['edge']);
  });

  it('advancing to an earlier time throws and leaves jobs queued', async () => {
    const { clock, scheduler } = setup();
    clock.set(d('2026-11-05T00:00:00.000Z'));
    scheduler.schedule(d('2026-11-06T00:00:00.000Z'), 'a', async () => {});
    await expect(scheduler.advanceTo(d('2026-11-02T00:00:00.000Z'))).rejects.toThrow(/backwards/);
    expect(scheduler.pending()).toBe(1);
  });

  it('awaits each job before starting the next', async () => {
    const { scheduler, log } = setup();
    scheduler.schedule(d('2026-11-02T00:00:00.000Z'), 'slow', async () => {
      await new Promise((r) => setTimeout(r, 20));
      log.push('slow');
    });
    scheduler.schedule(d('2026-11-03T00:00:00.000Z'), 'fast', async () => void log.push('fast'));
    await scheduler.advanceTo(d('2026-11-04T00:00:00.000Z'));
    expect(log).toEqual(['slow', 'fast']);
  });

  it('a failing job rejects advanceTo with the job label, keeps the clock at the job time, and keeps later jobs', async () => {
    const { clock, scheduler } = setup();
    scheduler.schedule(d('2026-11-02T00:00:00.000Z'), 'boom', async () => {
      throw new Error('kaput');
    });
    scheduler.schedule(d('2026-11-03T00:00:00.000Z'), 'after', async () => {});
    await expect(scheduler.advanceTo(d('2026-11-05T00:00:00.000Z'))).rejects.toThrow(/boom.*kaput/);
    expect(iso(clock.now())).toBe('2026-11-02T00:00:00.000Z');
    expect(scheduler.pending()).toBe(1);
  });
});

describe('addInterval', () => {
  const step = (from: string, unit: Parameters<typeof addInterval>[1], count: number, anchor: number) =>
    iso(addInterval(d(from), unit, count, anchor));

  it('month-end anchor 31 Jan → 28 Feb → 31 Mar', () => {
    const feb = step('2026-01-31T00:00:00.000Z', 'MONTH', 1, 31);
    expect(feb).toBe('2026-02-28T00:00:00.000Z');
    const mar = step(feb, 'MONTH', 1, 31);
    expect(mar).toBe('2026-03-31T00:00:00.000Z');
    const apr = step(mar, 'MONTH', 1, 31);
    expect(apr).toBe('2026-04-30T00:00:00.000Z');
    expect(step(apr, 'MONTH', 1, 31)).toBe('2026-05-31T00:00:00.000Z');
  });

  it('leap year: 31 Jan → 29 Feb', () => {
    expect(step('2028-01-31T00:00:00.000Z', 'MONTH', 1, 31)).toBe('2028-02-29T00:00:00.000Z');
  });

  it('plain monthly step keeps the day and time of day', () => {
    expect(step('2026-11-01T09:30:15.250Z', 'MONTH', 1, 1)).toBe('2026-12-01T09:30:15.250Z');
    expect(step('2026-12-01T00:00:00.000Z', 'MONTH', 1, 1)).toBe('2027-01-01T00:00:00.000Z');
  });

  it('multi-month counts', () => {
    expect(step('2026-01-31T00:00:00.000Z', 'MONTH', 3, 31)).toBe('2026-04-30T00:00:00.000Z');
    expect(step('2026-01-15T00:00:00.000Z', 'MONTH', 12, 15)).toBe('2027-01-15T00:00:00.000Z');
  });

  it('year steps clamp 29 Feb and return to it on the next leap year', () => {
    expect(step('2028-02-29T00:00:00.000Z', 'YEAR', 1, 29)).toBe('2029-02-28T00:00:00.000Z');
    expect(step('2029-02-28T00:00:00.000Z', 'YEAR', 3, 29)).toBe('2032-02-29T00:00:00.000Z');
  });

  it('day and week steps are exact', () => {
    expect(step('2026-02-27T08:00:00.000Z', 'DAY', 2, 27)).toBe('2026-03-01T08:00:00.000Z');
    expect(step('2026-02-27T08:00:00.000Z', 'WEEK', 1, 27)).toBe('2026-03-06T08:00:00.000Z');
    expect(step('2026-02-27T08:00:00.000Z', 'DAY', 7, 27)).toBe('2026-03-06T08:00:00.000Z');
  });

  it('does not mutate its input', () => {
    const from = d('2026-01-31T00:00:00.000Z');
    addInterval(from, 'MONTH', 1, 31);
    expect(iso(from)).toBe('2026-01-31T00:00:00.000Z');
  });

  it('rejects a non-positive or non-integer count and a bad anchor', () => {
    const from = d('2026-01-31T00:00:00.000Z');
    expect(() => addInterval(from, 'MONTH', 0, 31)).toThrow();
    expect(() => addInterval(from, 'MONTH', 1.5, 31)).toThrow();
    expect(() => addInterval(from, 'MONTH', 1, 0)).toThrow();
    expect(() => addInterval(from, 'MONTH', 1, 32)).toThrow();
  });
});
