import type { Report } from '@fastforward/contracts';
import { CHECK_TITLES, fmtDateTime } from '../format.js';

interface Props {
  report: Report | null;
  onSelect: (eventId: string) => void;
}

const ICON = { pass: '✓', fail: '✗', skipped: '–' } as const;
const WORD = { pass: 'Passed', fail: 'Failed', skipped: 'Skipped' } as const;

export function ReportPanel({ report, onSelect }: Props) {
  if (!report) {
    return (
      <div className="empty">
        <p>
          <strong>No report yet.</strong>
        </p>
        <p className="muted">The checks run as the run advances. Move the date forward.</p>
      </div>
    );
  }
  const failed = report.checks.filter((c) => c.status === 'fail').length;
  return (
    <div className="report">
      <p className={`verdict ${failed ? 'bad' : 'ok'}`}>
        {failed ? `${failed} of ${report.checks.length} checks failed` : 'All checks passed'}
      </p>
      <p className="muted">
        {report.counts.events} events · {report.counts.deliveries} deliveries · {report.counts.customers} customers
      </p>
      <ul className="checks">
        {report.checks.map((c) => (
          <li key={c.id} className={`check ${c.status}`}>
            <div className="check-head">
              <span className={`status ${c.status}`} aria-label={WORD[c.status]}>
                {ICON[c.status]}
              </span>
              <div>
                <strong>{CHECK_TITLES[c.id]}</strong>
                <div className="muted mono small">{c.id}</div>
              </div>
            </div>
            {c.note && <p className="muted">{c.note}</p>}
            {c.findings.map((f, i) => (
              <article className="finding bad" key={i}>
                <p>
                  <strong>{f.summary}</strong>
                </p>
                <p className="muted small">{fmtDateTime(f.at)} (virtual)</p>
                {f.explanation && <p>{f.explanation}</p>}
                {f.fix && (
                  <p>
                    <strong>Fix:</strong> {f.fix}
                  </p>
                )}
                {f.eventIds[0] && (
                  <button type="button" className="link" onClick={() => onSelect(f.eventIds[0]!)}>
                    Show the evidence in the table
                  </button>
                )}
              </article>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
