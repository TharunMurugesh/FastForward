export type Unit = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';

const DAY_MS = 86_400_000;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * `from` plus `count` billing intervals, in UTC. Day and week steps are exact. Month and year steps
 * keep the time of day and land on `anchorDay`, clamped to the last day of shorter months, so a
 * subscription anchored on the 31st bills 31 Jan → 28 Feb → 31 Mar rather than drifting to the 28th.
 */
export function addInterval(from: Date, unit: Unit, count: number, anchorDay: number): Date {
  if (!Number.isInteger(count) || count < 1) throw new Error(`interval count must be a positive integer, got ${count}`);
  if (!Number.isInteger(anchorDay) || anchorDay < 1 || anchorDay > 31) throw new Error(`anchor day must be 1-31, got ${anchorDay}`);

  if (unit === 'DAY') return new Date(from.getTime() + count * DAY_MS);
  if (unit === 'WEEK') return new Date(from.getTime() + count * 7 * DAY_MS);

  const months = unit === 'YEAR' ? count * 12 : count;
  const total = from.getUTCFullYear() * 12 + from.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  const out = new Date(from.getTime());
  out.setUTCFullYear(year, month, day);
  return out;
}
