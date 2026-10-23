import { CHECK_IDS, describeAi, type CheckId, type Report } from '@fastforward/contracts';

export const CHECK_TITLES: Record<CheckId, string> = {
  ACK_FAST: 'App answers PayPal fast',
  VERIFIES_SIGNATURES: 'App verifies each notice is from PayPal',
  STATE_MATCHES: 'Access matches the subscription status',
  FULFIL_ONCE: 'Each payment is fulfilled once',
  DISPUTE_ANSWERED: 'Disputes are answered in time',
  NO_LIVE_CALLS: 'No calls to live PayPal',
};

const MARK = { pass: '✓', fail: '✗', skipped: '–' } as const;
/** More findings than this are counted, not listed: one bad habit can repeat on every delivery. */
const SHOWN_PER_CHECK = 3;

const day = (iso: string) => iso.slice(0, 10);

const wrap = (text: string, indent: string, width = 92): string => {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width - indent.length) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => indent + l).join('\n');
};

export interface PrintContext {
  reportDir: string;
  /** Written next to report.json; shown when present. */
  htmlReport?: string;
  dashboardLink: string;
  /** True when the twin stays up after the run, so the dashboard link will work. */
  twinKept: boolean;
}

/** The terminal report: one line per check, the failures explained, then where to look next. */
export function formatReport(report: Report, ctx: PrintContext): string {
  const failed = report.checks.filter((c) => c.status === 'fail');
  const out: string[] = [];
  out.push(`Fastforward run ${report.runId}: ${report.scenario}, ${day(report.start)} to ${day(report.end)}`);
  out.push(`${report.counts.customers} customers, ${report.counts.events} events, ${report.counts.deliveries} deliveries (all simulated)`);
  if (report.ai) out.push(`AI: ${describeAi(report.ai)}`);
  out.push('');
  for (const id of CHECK_IDS) {
    const c = report.checks.find((x) => x.id === id);
    if (!c) continue;
    out.push(`  ${MARK[c.status]} ${id.padEnd(20)} ${CHECK_TITLES[id]}${c.status === 'skipped' && c.note ? `  (${c.note})` : ''}`);
    if (c.status !== 'fail') continue;
    const shown = c.findings.slice(0, SHOWN_PER_CHECK);
    for (const f of shown) out.push(wrap(f.summary, '      '));
    // One bad habit repeats on every delivery, so the explanation and the fix are said once per check.
    const help = shown.find((f) => f.explanation || f.fix);
    if (help?.explanation) out.push(wrap(help.explanation, '        '));
    if (help?.fix) out.push(wrap(`Fix: ${help.fix}`, '        '));
    if (c.findings.length > SHOWN_PER_CHECK) out.push(`      … and ${c.findings.length - SHOWN_PER_CHECK} more (see the report file)`);
  }
  out.push('');
  out.push(failed.length > 0 ? `${failed.length} of ${report.checks.length} checks failed.` : 'No checks failed.');
  out.push(`Report:    ${ctx.reportDir}/report.json`);
  if (ctx.htmlReport) out.push(`           ${ctx.htmlReport.replaceAll('\\', '/')}  (open in a browser)`);
  out.push(`Dashboard: ${ctx.dashboardLink}${ctx.twinKept ? '' : '  (open it while the twin is running; use --keep-twin)'}`);
  return out.join('\n') + '\n';
}

