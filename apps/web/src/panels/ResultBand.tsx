import type { CheckId, CheckResult, Report } from '@fastforward/contracts';
import { CHECK_TITLES, describeAi, explanationLabel, fmtDateTime, runSummary } from '../format.js';

interface Props {
  report: Report | null;
  /** How many notices in the table are evidence for each check. */
  noticeCounts: Partial<Record<CheckId, number>>;
  /** The check the table is currently filtered to, if any. */
  activeCheck: CheckId | null;
  /** Filters the deliveries table to one check's evidence (null shows every notice again). */
  onFilter: (check: CheckId | null) => void;
}

const ICON = { pass: '✓', fail: '✗', skipped: '–' } as const;
const WORD = { pass: 'Passed', fail: 'Failed', skipped: 'Skipped' } as const;
const EXAMPLES = 3;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One failed check: what went wrong and how to fix it, visible without a click. */
function FailedCard({ check, notices, active, onFilter }: { check: CheckResult; notices: number; active: boolean; onFilter: (c: CheckId | null) => void }) {
  const help = check.findings.find((f) => f.explanation || f.fix);
  const label = explanationLabel(help?.explanationSource);
  return (
    <article className={`failed-card${active ? ' on' : ''}`} aria-label={`Failed: ${CHECK_TITLES[check.id]}`}>
      <header>
        <span className="status fail" aria-label={WORD.fail}>
          {ICON.fail}
        </span>
        <div>
          <h3>{CHECK_TITLES[check.id]}</h3>
          <span className="muted mono small">{check.id}</span>
        </div>
      </header>
      {help?.explanation && <p className="explain">{help.explanation}</p>}
      {help?.fix && (
        <p className="fix">
          <strong>Fix:</strong> {help.fix}
        </p>
      )}
      {notices === 0 && (
        // Findings about state over time point at no single notice, so list them here instead.
        <ul className="examples">
          {check.findings.slice(0, EXAMPLES).map((f, i) => (
            <li key={i}>
              {f.summary} <span className="muted small">{fmtDateTime(f.at)} (virtual)</span>
            </li>
          ))}
          {check.findings.length > EXAMPLES && <li className="muted">… and {check.findings.length - EXAMPLES} more</li>}
        </ul>
      )}
      <footer>
        {label ? <span className="muted small">{label}</span> : <span />}
        {notices > 0 && (
          <button type="button" className={`count-button${active ? ' on' : ''}`} aria-pressed={active} onClick={() => onFilter(active ? null : check.id)}>
            {active ? 'Show every notice' : `Show the ${plural(notices, 'notice', 'notices')} ↓`}
          </button>
        )}
      </footer>
    </article>
  );
}

/** The verdict first: the result of the run, all six checks at a glance, and each failure explained. */
export function ResultBand({ report, noticeCounts, activeCheck, onFilter }: Props) {
  if (!report) {
    return (
      <section className="card result-head pending" aria-label="Result">
        <div className="result-verdict">
          <p className="big-verdict">No verdict yet</p>
          <p className="muted">The checks run as the run advances. Move the date forward, or press "Run to end".</p>
        </div>
      </section>
    );
  }
  const failing = report.checks.filter((c) => c.status === 'fail');
  return (
    <section className="result" aria-label="Result">
      <div className={`card result-head ${failing.length ? 'bad' : 'ok'}`}>
        <div className="result-verdict">
          <p className="big-verdict">{failing.length ? `${failing.length} of ${report.checks.length} checks failed` : `All ${report.checks.length} checks passed`}</p>
          <p className="muted">{runSummary(report)}</p>
          {report.ai && <p className="muted small">{describeAi(report.ai)}</p>}
        </div>
        <ul className="check-pills" aria-label="All checks">
          {report.checks.map((c) => (
            <li key={c.id} className={`pill ${c.status}`} title={c.status === 'skipped' ? (c.note ?? 'Skipped') : `${WORD[c.status]} · ${c.id}`}>
              <span className={`status ${c.status}`} aria-label={WORD[c.status]}>
                {ICON[c.status]}
              </span>
              <span>{CHECK_TITLES[c.id]}</span>
            </li>
          ))}
        </ul>
      </div>
      {failing.length > 0 && (
        <div className="failed-cards">
          {failing.map((c) => (
            <FailedCard key={c.id} check={c} notices={noticeCounts[c.id] ?? 0} active={activeCheck === c.id} onFilter={onFilter} />
          ))}
        </div>
      )}
    </section>
  );
}
