import { describe, expect, it } from 'vitest';
import { badMonth } from '../src/fixtures/bad-month.js';
import { toDeliveryRows, toNoticeRows } from '../src/grids/rows.js';
import { firstSentence, problemFacts } from '../src/problems.js';

const check = (id: string) => badMonth.report.checks.find((c) => c.id === id)!;
const notices = toNoticeRows(toDeliveryRows(badMonth.trace, badMonth.subscriptions, badMonth.report));
const facts = (id: string) => problemFacts(check(id), notices, badMonth.trace, badMonth.subscriptions);

describe('problemFacts', () => {
  it('counts the same rows the table shows for the check, copies included', () => {
    const f = facts('FULFIL_ONCE');
    const rows = notices.filter((n) => n.failedChecks.includes('FULFIL_ONCE'));
    expect(rows.some((n) => n.duplicate)).toBe(true);
    expect(f.notices).toBe(rows.length);
  });

  it('points a paid-twice failure at the payment handler', () => {
    const f = facts('FULFIL_ONCE');
    expect(f.handlers.map((h) => h.eventType)).toEqual(['PAYMENT.SALE.COMPLETED']);
    expect(f.handlers[0]!.count).toBe(f.notices);
  });

  it('lists customers in run order and handlers most-affected first', () => {
    const f = facts('VERIFIES_SIGNATURES');
    const order = badMonth.subscriptions.map((s) => s.customer);
    expect(f.customers).toEqual(order.filter((c) => f.customers.includes(c)));
    const counts = f.handlers.map((h) => h.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(f.notices).toBe(counts.reduce((a, b) => a + b, 0));
  });

  it('falls back to the events named by findings when no table row carries the check', () => {
    const c = check('FULFIL_ONCE');
    const f = problemFacts(c, [], badMonth.trace, badMonth.subscriptions);
    expect(f.notices).toBe(0);
    expect(f.handlers.map((h) => h.eventType)).toEqual(['PAYMENT.SALE.COMPLETED']);
    expect(f.customers.length).toBeGreaterThan(0);
  });

  it('gives nothing for a check with no findings', () => {
    expect(problemFacts({ id: 'ACK_FAST', status: 'pass', findings: [] }, notices, badMonth.trace, badMonth.subscriptions)).toEqual({ notices: 0, customers: [], handlers: [] });
  });
});

describe('firstSentence', () => {
  it('stops at the first full stop followed by a space', () => {
    expect(firstSentence('PayPal sent it twice. Your app shipped both.')).toBe('PayPal sent it twice.');
  });
  it('does not cut inside an amount or an id', () => {
    expect(firstSentence('A $12.00 claim on PP-D-1. Then more.')).toBe('A $12.00 claim on PP-D-1.');
  });
  it('returns text with no full stop unchanged', () => {
    expect(firstSentence('  no stop here ')).toBe('no stop here');
  });
});
