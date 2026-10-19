import type { CheckId, CheckResult, Report } from '@fastforward/contracts';
import { CHECK_TITLES, fmtDateTime } from '../format.js';

interface Props {
  report: Report | null;
  /** How many notices in the grid are evidence for each check. */
  noticeCounts: Partial<Record<CheckId, number>>;
  /** The check the grid is currently filtered to, if any. */
  activeCheck: CheckId | null;
  onFilter: (check: CheckId | null) => void;
  onSelect: (eventId: string) => void;
}

const ICON = { pass: '✓', fail: '✗', skipped: '–' } as const;
const WORD = { pass: 'Passed', fail: 'Failed', skipped: 'Skipped' } as const;
const EXAMPLES = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function FailingCheck({ check, notices, active, onFilter, onSelect }: { check: CheckResult; notices: number; active: boolean; onFilter: (c: CheckId | null) => void; onSelect: (id: string) => void }) {
  const help = check.findings.find((f) => f.explanation || f.fix);
  return (
    <li className="check fail">
      <div className="check-line">
        <span className="status fail" aria-label={WORD.fail}>
          {ICON.fail}
        </span>
        <div className="check-name">
          <strong>{CHECK_TITLES[check.id]}</strong>
          <span className="muted mono small">{check.id}</span>
        </div>
        {notices > 0 ? (
          <button
            type="button"
            className={`count-button${active ? ' on' : ''}`}
            aria-pressed={active}
            title={active ? 'Show every notice again' : 'Show only the notices that are evidence for this check'}
            onClick={() => onFilter(active ? null : check.id)}
          >
            {plural(notices, 'notice', 'notices')}
          </button>
        ) : (
          <span className="muted small" title="This finding is about state over time, not one notice">
            {plural(check.findings.length, 'finding', 'findings')}
          </span>
        )}
      </div>
      <details>
        <summary>What happened and how to fix it</summary>
        <div className="finding bad">
          {help?.explanation && <p>{help.explanation}</p>}
          {help?.fix && (
            <p>
              <strong>Fix:</strong> {help.fix}
            </p>
          )}
        </div>
        <ul className="examples">
          {check.findings.slice(0, EXAMPLES).map((f, i) => (
            <li key={i}>
              <span>{f.summary}</span> <span className="muted small">{fmtDateTime(f.at)} (virtual)</span>
              {f.eventIds[0] && (
                <>
                  {' '}
                  <button type="button" className="link" onClick={() => onSelect(f.eventIds[0]!)}>
                    Show the notice
                  </button>
                </>
              )}
            </li>
          ))}
          {check.findings.length > EXAMPLES && <li className="muted">… and {check.findings.length - EXAMPLES} more</li>}
        </ul>
      </details>
    </li>
  );
}

export function ReportPanel({ report, noticeCounts, activeCheck, onFilter, onSelect }: Props) {
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
  const failing = report.checks.filter((c) => c.status === 'fail');
  const others = report.checks.filter((c) => c.status !== 'fail');
  return (
    <div className="report">
      <p className={`verdict ${failing.length ? 'bad' : 'ok'}`}>{failing.length ? `${failing.length} of ${report.checks.length} checks failed` : 'All checks passed'}</p>
      <p className="muted">
        {report.counts.events} events · {report.counts.deliveries} deliveries · {report.counts.customers} customers
      </p>
      {failing.length > 0 && (
        <>
          <p className="hint muted small">Click a count to see just those notices in the table.</p>
          <ul className="checks">
            {failing.map((c) => (
              <FailingCheck key={c.id} check={c} notices={noticeCounts[c.id] ?? 0} active={activeCheck === c.id} onFilter={onFilter} onSelect={onSelect} />
            ))}
          </ul>
        </>
      )}
      {others.length > 0 && (
        <ul className="checks quiet">
          {others.map((c) => (
            <li key={c.id} className={`check ${c.status}`}>
              <div className="check-line">
                <span className={`status ${c.status}`} aria-label={WORD[c.status]}>
                  {ICON[c.status]}
                </span>
                <div className="check-name">
                  <span>{CHECK_TITLES[c.id]}</span>
                  <span className="muted mono small">{c.id}</span>
                </div>
                <span className="muted small">{c.status === 'skipped' ? (c.note ?? 'skipped') : 'passed'}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
