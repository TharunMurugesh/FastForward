import type { CheckId, CheckResult, Report, TraceEntry } from '@fastforward/contracts';
import type { ReactNode } from 'react';
import { CircleCheck, CircleMinus, CircleX, ListFilter, Sparkles, Users, Webhook, Wrench } from 'lucide-react';
import { CheckBadge, CHECK_LOOK, Story } from '../checkLook.js';
import { CHECK_TITLES, describeAi, EVENT_LABELS, runSummary } from '../format.js';
import type { NoticeRow } from '../grids/rows.js';
import { firstSentence, problemFacts } from '../problems.js';

interface Props {
  report: Report;
  /** The deliveries table's rows, so the counts here match what the table shows. */
  notices: NoticeRow[];
  trace: TraceEntry[];
  subscriptions: { customer: string; subscriptionId: string }[];
  /** Opens the full explanation and fix for one check. */
  onExplain: (check: CheckId) => void;
  /** Shows the deliveries tab filtered to one check's notices. */
  onShowNotices: (check: CheckId) => void;
}

const STATUS = {
  pass: { icon: CircleCheck, word: 'Passed' },
  fail: { icon: CircleX, word: 'Failed' },
  skipped: { icon: CircleMinus, word: 'Skipped' },
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One tile per check: the whole result readable in a glance. */
function CheckTile({ check }: { check: CheckResult }) {
  const { icon: Icon, word } = STATUS[check.status];
  return (
    <li className={`check-tile ${check.status} ${CHECK_LOOK[check.id].tone}`} title={check.status === 'skipped' ? check.note : CHECK_TITLES[check.id]}>
      <CheckBadge id={check.id} />
      <span className="tile-name">{CHECK_LOOK[check.id].short}</span>
      <span className={`tile-status ${check.status}`}>
        <Icon size={15} strokeWidth={2.4} aria-hidden="true" />
        {word}
      </span>
    </li>
  );
}

/** One failure: the picture of what happened, where in the app to look, and the way to the fix. */
export function ProblemCard({ check, notices, trace, subscriptions, onExplain, onShowNotices }: { check: CheckResult } & Omit<Props, 'report'>) {
  const facts = problemFacts(check, notices, trace, subscriptions);
  // Past two handlers a list stops helping: the problem is in every handler.
  const everyHandler = facts.handlers.length > 2;
  const fix = check.findings.find((f) => f.fix)?.fix;
  return (
    <article className={`problem ${CHECK_LOOK[check.id].tone}`} aria-label={`Failed: ${CHECK_TITLES[check.id]}`}>
      <header>
        <CheckBadge id={check.id} size="lg" />
        <div>
          <h3>{CHECK_TITLES[check.id]}</h3>
          <span className="muted mono small">{check.id}</span>
        </div>
      </header>
      <Story id={check.id} />
      <ul className="facts-row">
        {everyHandler && (
          <li title={facts.handlers.map((h) => `${h.eventType} ×${h.count}`).join('\n')}>
            <Webhook size={15} aria-hidden="true" />
            <span>
              Look at <strong>every</strong> webhook handler ({facts.handlers.length} notice types)
            </span>
          </li>
        )}
        {!everyHandler && facts.handlers.length > 0 && (
          <li title="The webhook handlers in your app that received these notices">
            <Webhook size={15} aria-hidden="true" />
            <span>
              Look at your{' '}
              {facts.handlers.map((h, i) => (
                <span key={h.eventType}>
                  {i > 0 && ', '}
                  <code title={EVENT_LABELS[h.eventType]}>{h.eventType}</code> <span className="muted">×{h.count}</span>
                </span>
              ))}{' '}
              {facts.handlers.length === 1 ? 'handler' : 'handlers'}
            </span>
          </li>
        )}
        {facts.customers.length > 0 && (
          <li>
            <Users size={15} aria-hidden="true" />
            <span>{facts.customers.join(', ')}</span>
          </li>
        )}
      </ul>
      {fix && (
        <p className="fix-preview">
          <Wrench size={15} aria-hidden="true" />
          <span>{firstSentence(fix)}</span>
        </p>
      )}
      <footer>
        <button type="button" className="primary" onClick={() => onExplain(check.id)}>
          <Wrench size={15} aria-hidden="true" /> How to fix
        </button>
        {facts.notices > 0 && (
          <button type="button" onClick={() => onShowNotices(check.id)}>
            <ListFilter size={15} aria-hidden="true" /> See the {plural(facts.notices, 'notice', 'notices')}
          </button>
        )}
      </footer>
    </article>
  );
}

/** The first tab: did the app pass, and if not, what to fix first. `children` goes under the cards (the timeline). */
export function Overview({ report, children, ...rest }: Props & { children?: ReactNode }) {
  const failing = report.checks.filter((c) => c.status === 'fail');
  return (
    <div className="overview">
      <section className={`card verdict-card ${failing.length ? 'bad' : 'ok'}`} aria-label="Result">
        <div className="verdict-text">
          <p className="big-verdict">
            {failing.length ? `${failing.length} of ${report.checks.length} checks failed` : `All ${report.checks.length} checks passed`}
          </p>
          <p className="muted">{runSummary(report)}</p>
          {report.ai && (
            <p className="ai-line small" title={describeAi(report.ai)}>
              <Sparkles size={14} aria-hidden="true" /> Explanations and customers by {report.ai.model}
              {(report.ai.calls ?? 0) === 0 && ', replayed from a recording'}
            </p>
          )}
        </div>
        <ul className="check-tiles" aria-label="All checks">
          {report.checks.map((c) => (
            <CheckTile key={c.id} check={c} />
          ))}
        </ul>
      </section>
      {failing.length > 0 ? (
        // Columns chosen by count, so no card is left alone beside empty slots (4 makes 2 by 2).
        <div className={`problems n-${failing.length}`}>
          {failing.map((c) => (
            <ProblemCard key={c.id} check={c} {...rest} />
          ))}
        </div>
      ) : (
        <section className="card all-good">
          <CircleCheck size={28} aria-hidden="true" />
          <div>
            <h3>No check found a problem in this run</h3>
            <p className="muted">Skipped checks had nothing to look at; hover one to see why.</p>
          </div>
        </section>
      )}
      {children}
    </div>
  );
}
