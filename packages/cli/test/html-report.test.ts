import { readFileSync } from 'node:fs';
import { CHECK_IDS, parseScenario, type CheckResult, type Finding, type Report, type TraceEntry } from '@fastforward/contracts';
import { describe, expect, it } from 'vitest';
import { renderHtmlReport } from '../src/index.js';

const finding = (n: number, over: Partial<Finding> = {}): Finding => ({
  at: '2026-12-01T00:00:00.000Z',
  summary: `Notice ${n} was accepted without checking its signature`,
  eventIds: [`WH-${n}`],
  explanation: 'Your app acted on a notice without checking that PayPal sent it.',
  fix: 'Call the verify endpoint first.',
  ...over,
});

const report = (checks: CheckResult[]): Report => ({
  runId: 'run-ab12cd34',
  scenario: 'bad-month',
  start: '2026-11-01T00:00:00.000Z',
  end: '2027-01-15T00:00:00.000Z',
  checks,
  counts: { events: 21, deliveries: 25, customers: 3 },
});

const allChecks = (): CheckResult[] => [
  { id: 'ACK_FAST', status: 'pass', findings: [] },
  { id: 'VERIFIES_SIGNATURES', status: 'fail', findings: [finding(1), finding(2)] },
  { id: 'STATE_MATCHES', status: 'skipped', findings: [], note: 'no probeUrl in the scenario' },
  { id: 'FULFIL_ONCE', status: 'fail', findings: [finding(3, { explanation: 'PayPal sent the same notice twice.', fix: 'Remember event ids.' })] },
  { id: 'DISPUTE_ANSWERED', status: 'pass', findings: [] },
  { id: 'NO_LIVE_CALLS', status: 'pass', findings: [] },
];

describe('renderHtmlReport', () => {
  it('contains each check id and its status', () => {
    const html = renderHtmlReport(report(allChecks()));
    for (const id of CHECK_IDS) expect(html).toContain(id);
    expect(html).toMatch(/VERIFIES_SIGNATURES[\s\S]*?Failed/);
    expect(html).toMatch(/ACK_FAST[\s\S]*?Passed/);
    expect(html).toMatch(/STATE_MATCHES[\s\S]*?Skipped/);
    expect(html).toContain('no probeUrl in the scenario');
  });

  it('puts the verdict first, then the failing checks, then the passed and skipped ones', () => {
    const html = renderHtmlReport(report(allChecks()));
    const verdict = html.indexOf('2 of 6 checks failed');
    const failing = html.indexOf('Each payment is fulfilled once');
    const passed = html.indexOf('App answers PayPal fast');
    expect(verdict).toBeGreaterThan(-1);
    expect(verdict).toBeLessThan(failing);
    expect(failing).toBeLessThan(passed);
  });

  it('says all passed when nothing failed', () => {
    const html = renderHtmlReport(report(allChecks().map((c) => ({ ...c, status: 'pass' as const, findings: [] }))));
    expect(html).toContain('All checks passed');
  });

  it('shows the explanation and fix once per failing check, and each finding', () => {
    const html = renderHtmlReport(report(allChecks()));
    expect(html.match(/Your app acted on a notice without checking that PayPal sent it\./g)).toHaveLength(1);
    expect(html).toContain('Fix:');
    expect(html).toContain('Call the verify endpoint first.');
    expect(html).toContain('Notice 1 was accepted without checking its signature');
    expect(html).toContain('Notice 2 was accepted without checking its signature');
    expect(html).toContain('WH-1');
  });

  it('escapes payload text, so a script in a summary renders inert', () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const html = renderHtmlReport(
      report([{ id: 'VERIFIES_SIGNATURES', status: 'fail', findings: [finding(1, { summary: evil, explanation: evil, fix: evil, eventIds: [evil] })] }]),
      { scenario: { ...parseScenario(readFileSync(new URL('../../../examples/coffee-club/scenarios/bad-month.yaml', import.meta.url), 'utf8')), name: evil } },
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('contains no script at all and makes no external requests', () => {
    const html = renderHtmlReport(report(allChecks()));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/@import|url\(/i);
    expect(html).not.toMatch(/https?:\/\//i); // the template itself has no URLs, not even an svg namespace
  });

  it('shows a URL only where it is the user\'s own data', () => {
    const scenario = parseScenario(readFileSync(new URL('../../../examples/coffee-club/scenarios/bad-month.yaml', import.meta.url), 'utf8'));
    const html = renderHtmlReport(report(allChecks()), { scenario });
    const urls = html.match(/https?:\/\/[^\s<",]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(scenario.app.webhookUrl + (scenario.app.subscribeUrl ?? '') + (scenario.app.probeUrl ?? '')).toContain(u);
  });

  it('labels the page as a simulated run, in the header and in a print footer that repeats on every page', () => {
    const html = renderHtmlReport(report(allChecks()));
    expect((html.match(/Simulated run/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/@media print[\s\S]*position:\s*fixed/);
  });

  it('is a complete, readable document in light and dark mode', () => {
    const html = renderHtmlReport(report(allChecks()));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('<title>');
  });

  it('lists the first findings of a check and counts the rest, so a repeating bug stays readable', () => {
    const many = Array.from({ length: 25 }, (_, i) => finding(i + 1));
    const html = renderHtmlReport(report([{ id: 'VERIFIES_SIGNATURES', status: 'fail', findings: many }]));
    expect(html).toContain('Notice 10 was accepted');
    expect(html).not.toContain('Notice 11 was accepted');
    expect(html).toContain('and 15 more');
    expect(html).toContain('25 findings');
  });

  it('stays small: a typical report is tens of kilobytes, even a huge one is bounded', () => {
    expect(renderHtmlReport(report(allChecks())).length).toBeLessThan(30_000);
    const huge = CHECK_IDS.map((id) => ({ id, status: 'fail' as const, findings: Array.from({ length: 2000 }, (_, i) => finding(i)) }));
    expect(renderHtmlReport(report(huge)).length).toBeLessThan(120_000);
  });

  describe('with the scenario and trace', () => {
    const scenario = parseScenario(readFileSync(new URL('../../../examples/coffee-club/scenarios/bad-month.yaml', import.meta.url), 'utf8'));
    const trace: TraceEntry[] = [
      { at: '2026-11-01T00:00:00.000Z', kind: 'event', forged: false, event: { id: 'E1', event_version: '1.0', create_time: '2026-11-01T00:00:00.000Z', resource_type: 'sale', event_type: 'PAYMENT.SALE.COMPLETED', summary: 's', resource: {}, links: [] } },
      { at: '2026-11-01T00:00:02.000Z', kind: 'delivery', eventId: 'E1', attempt: 1, status: null, ms: 10000, verifyCalled: false, transmissionId: 't1' },
      { at: '2026-11-01T00:01:02.000Z', kind: 'delivery', eventId: 'E1', attempt: 2, status: 200, ms: 30, verifyCalled: true, transmissionId: 't2' },
    ];

    it('adds what was run and what happened, with the customers and the delivery numbers', () => {
      const html = renderHtmlReport(report(allChecks()), { scenario, trace });
      for (const c of scenario.customers) expect(html).toContain(c.name);
      expect(html).toContain('2 delivery attempts');
      expect(html).toContain('1 timed out');
      expect(html).toContain('Coffee Club Monthly');
    });

    it('still renders without them', () => {
      expect(renderHtmlReport(report(allChecks()), {})).toContain('bad-month');
    });
  });
});

describe('who wrote the words', () => {
  const withSource = (source: 'model' | 'template') =>
    report([{ id: 'FULFIL_ONCE', status: 'fail', findings: [finding(1, { explanation: 'Words about the duplicate.', explanationSource: source })] }]);

  it('labels an explanation as written by the model or as built-in text', () => {
    expect(renderHtmlReport(withSource('model'))).toContain('Written by Claude');
    expect(renderHtmlReport(withSource('template'))).toContain('Built-in text');
    expect(renderHtmlReport(withSource('template'))).not.toContain('Written by Claude');
  });

  it('adds a line saying how much the model did when the run used it, and none otherwise', () => {
    const ai = { model: 'claude-opus-5-5', customerDecisions: { model: 2, total: 3 }, explanations: { model: 1, total: 1 } };
    const html = renderHtmlReport({ ...withSource('model'), ai });
    expect(html).toContain('claude-opus-5-5 wrote 2 of 3 customer decisions and 1 of 1 explanations');
    expect(renderHtmlReport(withSource('template'))).not.toContain('customer decisions');
  });

  it('escapes the model name and the text, so nothing the model says can inject markup', () => {
    const html = renderHtmlReport({
      ...withSource('model'),
      ai: { model: '<script>x</script>', customerDecisions: { model: 0, total: 0 }, explanations: { model: 1, total: 1 } },
    });
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
