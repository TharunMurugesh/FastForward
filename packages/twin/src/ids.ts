import { randomInt } from 'node:crypto';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function chars(n: number, alphabet = ALNUM): string {
  let out = '';
  for (let i = 0; i < n; i += 1) out += alphabet[randomInt(alphabet.length)];
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
