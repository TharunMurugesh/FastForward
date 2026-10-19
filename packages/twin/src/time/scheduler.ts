import type { VirtualClock } from './clock.js';

interface Job {
  at: number;
  seq: number;
  label: string;
  run: () => Promise<void>;
}

/**
 * Runs jobs in virtual-time order. A sorted array is enough: it stays fast for the 100k jobs a big
 * scenario produces, and ties keep insertion order via `seq`.
 */
export class Scheduler {
  private readonly jobs: Job[] = [];
  private seq = 0;

  constructor(private readonly clock: VirtualClock) {}

  schedule(at: Date, label: string, job: () => Promise<void>): void {
    const entry: Job = { at: at.getTime(), seq: this.seq++, label, run: job };
    if (Number.isNaN(entry.at)) throw new Error(`job "${label}" scheduled at an invalid date`);
    // Insert after every job that is due no later than this one: keeps ties in insertion order.
    let lo = 0;
    let hi = this.jobs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.jobs[mid]!.at <= entry.at) lo = mid + 1;
      else hi = mid;
    }
    this.jobs.splice(lo, 0, entry);
  }

  /**
   * Runs every job due at or before `target`, in order, awaiting each. The clock is set to the job's
   * time first (a job scheduled in the past runs at the current time instead), and jobs may schedule
   * more jobs, which run in this same call if they are due. Ends with the clock at `target`.
   * Returns how many jobs ran. If a job throws, advanceTo rejects; the clock stays at that job's time
   * and later jobs stay queued.
   */
  async advanceTo(target: Date): Promise<number> {
    if (target.getTime() < this.clock.now().getTime()) {
      throw new Error(`cannot advance backwards to ${target.toISOString()}; the clock is at ${this.clock.now().toISOString()}`);
    }
    let ran = 0;
    for (let next = this.jobs[0]; next !== undefined && next.at <= target.getTime(); next = this.jobs[0]) {
      this.jobs.shift();
      this.clock.set(new Date(Math.max(next.at, this.clock.now().getTime())));
      try {
        await next.run();
      } catch (err) {
        throw new Error(`job "${next.label}" failed: ${(err as Error).message}`, { cause: err });
      }
      ran += 1;
    }
    this.clock.set(target);
    return ran;
  }

  pending(): number {
    return this.jobs.length;
  }
}
