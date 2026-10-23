import { describeAi, explanationLabel, type CheckId, type CheckResult, type Finding, type Report, type Scenario, type TraceEntry } from '@fastforward/contracts';
import { CHECK_TITLES } from './print.js';

export interface HtmlReportOptions {
  /** The scenario that was run; adds a "what was run" section. */
  trace?: TraceEntry[];
  scenario?: Scenario;
}

/** More findings than this are counted, not listed: one bad habit repeats on every delivery. */
const SHOWN_PER_CHECK = 10;

const escapeHtml = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const e = escapeHtml;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
const day = (iso: string) => dateFmt.format(new Date(iso));
const dayTime = (iso: string) => `${dateFmt.format(new Date(iso))} ${timeFmt.format(new Date(iso))}`;

const STATUS_WORD = { pass: 'Passed', fail: 'Failed', skipped: 'Skipped' } as const;
const STATUS_ICON = { pass: '✓', fail: '✗', skipped: '–' } as const;

// Light and dark palettes match the dashboard. Everything is inline: the file must open offline, anywhere.
const CSS = `
:root{--bg:#f4f5f8;--surface:#fff;--surface-2:#f0f2f6;--text:#1b2230;--muted:#5a6577;--border:#dbe0e8;--ok:#17794a;--ok-bg:#e3f4ea;--bad:#be2222;--bad-bg:#fde8e8;--accent:#0b6bcb;--purple:#7a3d9e;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#0f1318;--surface:#181d1f;--surface-2:#20272b;--text:#e7eaef;--muted:#9aa5b6;--border:#2c353b;--ok:#52d08c;--ok-bg:#12301f;--bad:#ff7b7b;--bad-bg:#3a1a1c;--accent:#4aa3ff;--purple:#c58bea;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main,header.top{max-width:920px;margin:0 auto;padding:0 20px}
header.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding-top:24px;padding-bottom:8px}
h1{font-size:24px;line-height:1.15;margin:0}h2{font-size:18px;margin:0 0 8px}h3{font-size:16px;margin:0}h4{font-size:13px;margin:16px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
p{margin:0 0 8px}code,.mono{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12.5px}
.muted{color:var(--muted)}.small{font-size:13px}
.badge{background:var(--purple);color:#fff;font-weight:700;font-size:12px;letter-spacing:.05em;text-transform:uppercase;border-radius:999px;padding:3px 12px}
section,article{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin:16px 0}
.verdict h2{font-size:22px}.verdict.bad h2{color:var(--bad)}.verdict.ok h2{color:var(--ok)}
ul.lines{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
ul.lines li{display:flex;gap:10px;align-items:center}
.status{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;font-weight:800;flex:none}
.status.pass{background:var(--ok-bg);color:var(--ok)}.status.fail{background:var(--bad-bg);color:var(--bad)}.status.skipped{background:var(--surface-2);color:var(--muted)}
.count{margin-left:auto;background:var(--bad-bg);color:var(--bad);font-weight:700;border-radius:999px;padding:1px 12px;white-space:nowrap;font-size:13px}
.count a{color:inherit;text-decoration:none}
article.fail{border-left:5px solid var(--bad)}
.head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.help{background:var(--bad-bg);border-radius:8px;padding:10px 14px;margin-top:12px}
ol.findings{margin:6px 0 0;padding-left:22px;display:flex;flex-direction:column;gap:8px}
ol.findings .when{color:var(--muted);font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px}th{text-align:left;color:var(--muted);font-weight:600;padding:6px 10px 6px 0}td{padding:6px 10px 6px 0;border-top:1px solid var(--border);vertical-align:top}
footer.sim-footer{max-width:920px;margin:24px auto 32px;padding:0 20px;text-align:center;color:var(--muted);font-size:13px}
@media (max-width:640px){main,header.top{padding:0 12px}section,article{padding:14px}}
@media print{
  :root{--bg:#fff;--surface:#fff;--surface-2:#f0f0f0;--text:#000;--muted:#444;--border:#bbb;--bad:#a00;--bad-bg:#fbeaea;--ok:#075;--ok-bg:#e6f4ec;color-scheme:light}
  body{font-size:11pt}section,article{break-inside:avoid;box-shadow:none}
  footer.sim-footer{position:fixed;left:0;right:0;bottom:0;margin:0;padding:4px 0;border-top:1px solid var(--border);background:#fff}
  main{padding-bottom:36px}
}
`;

/** Says who wrote the explanation, when the report knows. */
function helpLabel(finding: Finding): string {
  const label = explanationLabel(finding.explanationSource);
  return label ? `<p class="muted small">${e(label)}</p>` : '';
}

function failingBlock(check: CheckResult): string {
  const help = check.findings.find((f: Finding) => f.explanation || f.fix);
  const shown = check.findings.slice(0, SHOWN_PER_CHECK);
  const rest = check.findings.length - shown.length;
  return `<article class="check fail" id="check-${e(check.id)}">
  <div class="head"><span class="status fail" aria-label="Failed">${STATUS_ICON.fail}</span><h3>${e(CHECK_TITLES[check.id])}</h3><code class="muted">${e(check.id)}</code><span class="muted small">${STATUS_WORD.fail}</span></div>
  <p class="muted small">${plural(check.findings.length, 'finding', 'findings')}</p>
  ${
    help
      ? `<div class="help">${help.explanation ? `<p>${e(help.explanation)}</p>` : ''}${help.fix ? `<p><strong>Fix:</strong> ${e(help.fix)}</p>` : ''}${helpLabel(help)}</div>`
      : ''
  }
  <h4>Findings</h4>
  <ol class="findings">
${shown
  .map(
    (f) =>
      `    <li>${e(f.summary)} <span class="when">${e(dayTime(f.at))} (virtual)</span>${f.eventIds.length > 0 ? ` <code class="muted">${f.eventIds.map(e).join(', ')}</code>` : ''}</li>`,
  )
  .join('\n')}
${rest > 0 ? `    <li class="muted">… and ${rest} more (see report.json for every one)</li>` : ''}
  </ol>
</article>`;
}

function quietLine(check: CheckResult): string {
  const note = check.status === 'skipped' ? (check.note ?? 'skipped') : '';
  return `    <li><span class="status ${check.status}" aria-label="${STATUS_WORD[check.status]}">${STATUS_ICON[check.status]}</span><span>${e(CHECK_TITLES[check.id])} <code class="muted">${e(check.id)}</code></span><span class="muted small" style="margin-left:auto">${STATUS_WORD[check.status]}${note ? `: ${e(note)}` : ''}</span></li>`;
}

function cardText(c: Scenario['customers'][number]): string {
  const card = c.card.kind === 'ok' ? 'card always works' : `card fails from ${c.card.date}`;
  const actions = c.actions.map((a) => `${a.do.replace('_', ' ')} on ${a.at.slice(0, 10)}`).join(', ');
  return actions ? `${card}; ${actions}` : card;
}

function scenarioSection(s: Scenario): string {
  const w = s.weather;
  const weather = [
    w.duplicates > 0 ? `${Math.round(w.duplicates * 100)}% of notices delivered twice` : '',
    w.reorder > 0 ? `${Math.round(w.reorder * 100)}% swapped with the next` : '',
    w.delayMinutes[1] > 0 ? `delays of ${w.delayMinutes[0]}–${w.delayMinutes[1]} minutes` : '',
    w.forged > 0 ? `${plural(w.forged, 'forged notice', 'forged notices')}` : '',
    w.burst ? 'every customer renews at the same instant' : '',
  ].filter(Boolean);
  return `<section>
  <h2>What was run</h2>
  <p>${e(s.name)}: ${plural(s.durationDays, 'day', 'days')} from ${e(day(s.start))}, plan <strong>${e(s.plan.name)}</strong> at ${e(s.plan.price)} ${e(s.plan.currency)} per ${e(s.plan.interval.toLowerCase())}. Weather: ${weather.length > 0 ? e(weather.join('; ')) : 'calm'}.</p>
  <table>
    <thead><tr><th>Customer</th><th>Who they are</th><th>What happens to them</th></tr></thead>
    <tbody>
${s.customers.map((c) => `      <tr><td>${e(c.name)}</td><td>${e(c.persona)}</td><td>${e(cardText(c))}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <p class="muted small" style="margin-top:10px">App under test: webhook ${e(s.app.webhookUrl)}${s.app.subscribeUrl ? `, subscribe ${e(s.app.subscribeUrl)}` : ''}${s.app.probeUrl ? `, probe ${e(s.app.probeUrl)}` : ''}</p>
</section>`;
}

function glanceSection(trace: TraceEntry[]): string {
  const events = trace.filter((t): t is Extract<TraceEntry, { kind: 'event' }> => t.kind === 'event');
  const attempts = trace.filter((t): t is Extract<TraceEntry, { kind: 'delivery' }> => t.kind === 'delivery');
  const timedOut = attempts.filter((a) => a.status === null).length;
  const errors = attempts.filter((a) => a.status !== null && a.status >= 300).length;
  const slowest = attempts.reduce((m, a) => Math.max(m, a.ms), 0);
  const checked = attempts.filter((a) => a.verifyCalled).length;
  const byType = new Map<string, number>();
  for (const ev of events) byType.set(ev.event.event_type, (byType.get(ev.event.event_type) ?? 0) + 1);
  return `<section>
  <h2>What happened</h2>
  <ul class="lines">
    <li>${plural(events.length, 'event', 'events')}: ${[...byType].map(([type, n]) => `${n} ${e(type)}`).join(', ') || 'none'}</li>
    <li>${plural(attempts.length, 'delivery attempt', 'delivery attempts')}: ${timedOut} timed out, ${errors} answered with an error, slowest answer ${slowest.toLocaleString('en-GB')} ms, signature checked on ${checked}</li>
  </ul>
</section>`;
}

/**
 * The report as one self-contained HTML file: no scripts, no external requests, readable offline,
 * in light and dark mode and on paper. The verdict comes first, then each failing check with what
 * happened and how to fix it, then the checks that passed or were skipped.
 */
export function renderHtmlReport(report: Report, opts: HtmlReportOptions = {}): string {
  const failing = report.checks.filter((c) => c.status === 'fail');
  const others = report.checks.filter((c) => c.status !== 'fail');
  const verdict = failing.length > 0 ? `${failing.length} of ${report.checks.length} checks failed` : 'All checks passed';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Fastforward report: ${e(report.scenario)} (${e(report.runId)})</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div>
    <h1>Fastforward report</h1>
    <p class="muted">${e(report.scenario)} · run ${e(report.runId)} · ${e(day(report.start))} to ${e(day(report.end))}</p>
  </div>
  <span class="badge" title="Nothing here is real money or real PayPal traffic">Simulated run</span>
</header>
<main>
<section class="verdict ${failing.length > 0 ? 'bad' : 'ok'}">
  <h2>${e(verdict)}</h2>
  <p class="muted">${plural(report.counts.events, 'event', 'events')} · ${plural(report.counts.deliveries, 'delivery', 'deliveries')} · ${plural(report.counts.customers, 'customer', 'customers')}</p>
${report.ai ? `  <p class="muted">${e(describeAi(report.ai))}</p>` : ''}
${
  failing.length > 0
    ? `  <ul class="lines">
${failing.map((c) => `    <li><span class="status fail" aria-label="Failed">${STATUS_ICON.fail}</span><span>${e(CHECK_TITLES[c.id as CheckId])} <code class="muted">${e(c.id)}</code></span><span class="count"><a href="#check-${e(c.id)}">${plural(c.findings.length, 'finding', 'findings')}</a></span></li>`).join('\n')}
  </ul>`
    : ''
}
</section>
${failing.map(failingBlock).join('\n')}
${
  others.length > 0
    ? `<section>
  <h2>Checks that did not fail</h2>
  <ul class="lines">
${others.map(quietLine).join('\n')}
  </ul>
</section>`
    : ''
}
${opts.scenario ? scenarioSection(opts.scenario) : ''}
${opts.trace ? glanceSection(opts.trace) : ''}
</main>
<footer class="sim-footer">Simulated run: Fastforward is a simulator. Webhooks carry an X-Fastforward-Run header and nothing here touched live PayPal.</footer>
</body>
</html>
`;
}
