/** The run's notion of "now". Only moves forward, and only when the scheduler or a caller says so. */
export class VirtualClock {
  private current: number;

  constructor(startIso: string) {
    const ms = Date.parse(startIso);
    if (Number.isNaN(ms)) throw new Error(`invalid clock start "${startIso}"`);
    this.current = ms;
  }

  /** A copy: mutating it does not move the clock. */
  now(): Date {
    return new Date(this.current);
  }

  set(d: Date): void {
    const ms = d.getTime();
    if (Number.isNaN(ms)) throw new Error('cannot set the clock to an invalid date');
    if (ms < this.current) {
      throw new Error(`cannot move the clock backwards (${new Date(this.current).toISOString()} → ${d.toISOString()})`);
    }
    this.current = ms;
  }
}
