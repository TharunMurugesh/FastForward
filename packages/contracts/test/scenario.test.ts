import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScenario } from '../src/index.js';

const badMonth = readFileSync(new URL('../../../examples/coffee-club/scenarios/bad-month.yaml', import.meta.url), 'utf8');

const minimal = `
name: minimal
seed: 1
start: 2026-11-01T00:00:00.000Z
duration: P30D
app:
  webhookUrl: http://127.0.0.1:3000/webhooks/paypal
plan:
  name: Basic
  price: "5.00"
  currency: USD
  interval: MONTH
customers:
  - name: Sam
    persona: Ordinary customer.
    card: ok
`;

describe('parseScenario', () => {
  it('parses bad-month.yaml', () => {
    const s = parseScenario(badMonth);
    expect(s.durationDays).toBe(75);
    expect(s.seed).toBe(42);
    const [maya, leo, ana] = s.customers;
    expect(maya?.email).toBe('maya@example.test');
    expect(leo?.card).toEqual({ kind: 'fails_from', date: '2026-12-01' });
    expect(ana?.actions[0]).toMatchObject({ at: '2026-11-20', do: 'dispute', reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED' });
    expect(s.weather).toEqual({ duplicates: 0.2, reorder: 0.1, delayMinutes: [0, 90], forged: 1, burst: false });
  });

  it('applies defaults', () => {
    const s = parseScenario(minimal);
    expect(s.weather).toEqual({ duplicates: 0, reorder: 0, delayMinutes: [0, 0], forged: 0, burst: false });
    expect(s.expect.accessWhile).toEqual(['ACTIVE']);
    expect(s.app.webhookId).toBe('WH-FF-LOCAL');
    expect(s.plan).toMatchObject({ trialDays: 0, totalCycles: 0, paymentFailureThreshold: 2 });
    expect(s.customers[0]?.actions).toEqual([]);
  });

  it('rejects missing app.webhookUrl', () => {
    const yaml = minimal.replace('  webhookUrl: http://127.0.0.1:3000/webhooks/paypal\n', '  probeUrl: http://x/probe\n');
    expect(() => parseScenario(yaml)).toThrow(/app\.webhookUrl/);
  });

  it('rejects duration not in P<n>D form', () => {
    expect(() => parseScenario(minimal.replace('P30D', 'P1M'))).toThrow(/duration/);
  });

  it('rejects a card value that is neither ok nor fails_from:<date>', () => {
    expect(() => parseScenario(minimal.replace('card: ok', 'card: sometimes'))).toThrow(/card/);
  });

  it('rejects an unknown dispute reason', () => {
    const yaml = badMonth.replace('MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'NOT_A_REASON');
    expect(() => parseScenario(yaml)).toThrow(/reason/);
  });
});
