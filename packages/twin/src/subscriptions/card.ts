import { randomInt } from 'node:crypto';

/**
 * A card in `subscriber.payment_source.card` on a create-subscription request. PayPal's sandbox activates such a
 * subscription at once and later returns only the safe parts of the card: brand, last digits, expiry, name and billing
 * address. The number and the security code are read here and never kept.
 */
export interface CardOnFile {
  name?: string;
  billing_address?: Record<string, unknown>;
  expiry?: string;
  brand?: string;
  last_digits: string;
}

export interface CardProblem {
  field: string;
  issue: string;
  description: string;
}

/** The brand from the first digits, or undefined when it is not one of the common four. */
export function brandOf(number: string): string | undefined {
  if (/^4/.test(number)) return 'VISA';
  if (/^(5[1-5]|2[2-7])/.test(number)) return 'MASTERCARD';
  if (/^3[47]/.test(number)) return 'AMEX';
  if (/^(6011|65)/.test(number)) return 'DISCOVER';
  return undefined;
}

/**
 * unverified: the 13 to 19 digit rule is PayPal's schema pattern for `number` (billing_subscriptions_v1.json);
 * what the sandbox answers for a bad number was not observed, so the error name and issue are guesses.
 */
export function readCard(card: unknown): { card: CardOnFile } | CardProblem {
  const c = typeof card === 'object' && card !== null ? (card as Record<string, unknown>) : {};
  const number = typeof c.number === 'string' ? c.number : '';
  if (!/^[0-9]{13,19}$/.test(number)) {
    return { field: '/subscriber/payment_source/card/number', issue: 'INVALID_PARAMETER_SYNTAX', description: 'The card number must be 13 to 19 digits.' };
  }
  const brand = brandOf(number);
  return {
    card: {
      ...(typeof c.name === 'string' ? { name: c.name } : {}),
      ...(typeof c.billing_address === 'object' && c.billing_address !== null ? { billing_address: { ...(c.billing_address as Record<string, unknown>) } } : {}),
      ...(typeof c.expiry === 'string' ? { expiry: c.expiry } : {}),
      ...(brand ? { brand } : {}),
      last_digits: number.slice(-4),
    },
  };
}

// PayPal's spec pattern for payer ids is ^[2-9A-HJ-NP-Z]{13}$: no 0, 1, I or O.
const PAYER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A PayPal-style payer id: 13 characters from the alphabet above. */
export function newPayerId(): string {
  let out = '';
  for (let i = 0; i < 13; i += 1) out += PAYER_ALPHABET[randomInt(PAYER_ALPHABET.length)];
  return out;
}
