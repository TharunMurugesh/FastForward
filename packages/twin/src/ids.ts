import { randomInt } from 'node:crypto';
import { mulberry32 } from './webhooks/weather.js';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** When set, ids come from the scenario's seed, so a rerun of a scenario has the same ids as the first run. */
let seeded: (() => number) | null = null;

/**
 * Makes every id from now on follow `seed` (null goes back to random). A run calls this with its scenario's seed, so
 * a recording of a run (the model's explanations quote ids) still matches when the same scenario is replayed later.
 * Ids stay unique inside a run because the sequence does not repeat; two runs with the same seed are meant to match.
 */
export function seedIds(seed: number | null): void {
  // A different stream from the weather's, which is seeded with the same number.
  seeded = seed === null ? null : mulberry32((seed ^ 0x1d5f00d) >>> 0);
}

/** A random whole number below n: from the seed when one is set, otherwise truly random. */
export function pickIndex(n: number): number {
  return seeded ? Math.floor(seeded() * n) : randomInt(n);
}

function chars(n: number, alphabet = ALNUM): string {
  let out = '';
  for (let i = 0; i < n; i += 1) out += alphabet[pickIndex(alphabet.length)];
  return out;
}

export type IdPrefix = 'I' | 'P' | 'PROD' | 'WH' | 'PP-D' | 'SALE';

/**
 * PayPal-like ids: subscription `I-` + 12, plan `P-` + 24, product `PROD-` + 17, webhook event
 * `WH-` + 17 + `-` + 17, dispute `PP-D-` + 5 digits. Sale ids are 17 bare characters in PayPal, so
 * `SALE` carries no prefix.
 */
export function newId(prefix: IdPrefix): string {
  switch (prefix) {
    case 'I':
      return `I-${chars(12)}`;
    case 'P':
      return `P-${chars(24)}`;
    case 'PROD':
      return `PROD-${chars(17)}`;
    case 'WH':
      return `WH-${chars(17)}-${chars(17)}`;
    case 'PP-D':
      return `PP-D-${chars(5, '0123456789')}`;
    case 'SALE':
      return chars(17);
  }
}
