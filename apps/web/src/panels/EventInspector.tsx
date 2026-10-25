import type { Report, TraceEntry } from '@fastforward/contracts';
import { Braces, MousePointerClick, Send, ShieldCheck, ShieldOff, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { CheckBadge, CHECK_LOOK } from '../checkLook.js';
import { CHECK_TITLES, EVENT_LABELS, fmtDateTime, explanationLabel } from '../format.js';
import { eventOwners } from '../timeline/model.js';
import { isSlowOrFailed } from '../grids/rows.js';

interface Props {
  eventId: string | null;
  trace: TraceEntry[];
  subscriptions: { customer: string; subscriptionId: string }[];
  report: Report | null;
}

export function EventInspector({ eventId, trace, subscriptions, report }: Props) {
  if (!eventId) {
    return (
      <div className="empty">
        <MousePointerClick size={28} className="muted" aria-hidden="true" />
        <p>
          <strong>Pick a notice</strong>
        </p>
        <p className="muted">Click a row or a marker to see what PayPal sent, how your app answered, and what to fix.</p>
      </div>
    );
  }

  const entry = trace.find((t): t is Extract<TraceEntry, { kind: 'event' }> => t.kind === 'event' && t.event.id === eventId);
  if (!entry) return <div className="empty muted">That event has not happened yet at this date.</div>;

  const deliveries = trace.filter((t): t is Extract<TraceEntry, { kind: 'delivery' }> => t.kind === 'delivery' && t.eventId === eventId);
  const transmissions = new Set(deliveries.map((d) => d.transmissionId));
  const verifies = trace.filter((t): t is Extract<TraceEntry, { kind: 'verify_call' }> => t.kind === 'verify_call' && transmissions.has(t.transmissionId));
  const owner = eventOwners(trace).get(eventId);
  const customer = subscriptions.find((s) => s.subscriptionId === owner)?.customer ?? '—';
  const findings = (report?.checks ?? []).flatMap((c) => c.findings.filter((f) => f.eventIds.includes(eventId)).map((f) => ({ check: c, finding: f })));

  return (
    <div className="inspector">
      <h3>
        {EVENT_LABELS[entry.event.event_type] ?? entry.event.event_type}
        {entry.forged && <span className="chip warn">forged</span>}
      </h3>
      <dl className="facts">
        <dt>Customer</dt>
        <dd>{customer}</dd>
        <dt>Event</dt>
        <dd className="mono">{entry.event.event_type}</dd>
        <dt>Event id</dt>
        <dd className="mono">{entry.event.id}</dd>
        <dt>Happened</dt>
        <dd>{fmtDateTime(entry.at)} (virtual)</dd>
        {entry.forged && (
          <>
            <dt>Signature</dt>
            <dd>Deliberately invalid. A correct app refuses it.</dd>
          </>
        )}
      </dl>

      <NoticeTabs
        key={eventId}
        problems={findings.length}
        attempts={deliveries.length}
        renderProblems={() =>
          findings.length === 0 ? (
            <p className="cell-ok">
              <ShieldCheck size={14} aria-hidden="true" /> No check found a problem with this notice.
            </p>
          ) : (
        <div className="stack">
          {findings.map(({ check, finding }, i) => (
            <article className={`finding ${CHECK_LOOK[check.id].tone}`} key={`${check.id}-${i}`}>
              <h4>
                <CheckBadge id={check.id} size="sm" /> {CHECK_TITLES[check.id]}
              </h4>
              <p>{finding.summary}</p>
              {finding.fix && (
                <p className="finding-fix">
                  <Wrench size={14} aria-hidden="true" /> <span>{finding.fix}</span>
                </p>
              )}
              {finding.explanation && (
                <details>
                  <summary>Why this matters</summary>
                  <p>{finding.explanation}</p>
                </details>
              )}
              {explanationLabel(finding.explanationSource) && <p className="muted small">{explanationLabel(finding.explanationSource)}</p>}
            </article>
          ))}
        </div>
          )
        }
        renderAttempts={() => (
          <>
      {deliveries.length === 0 ? (
        <p className="muted">Not delivered yet.</p>
      ) : (
        <table className="mini">
          <thead>
            <tr>
              <th>When</th>
              <th>Try</th>
              <th>Answer</th>
              <th>Took</th>
              <th>Signature</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d, i) => (
              <tr key={i} className={isSlowOrFailed(d) && !entry.forged ? 'bad' : ''}>
                <td>{fmtDateTime(d.at)}</td>
                <td>{d.attempt}</td>
                <td>{d.status === null ? 'timed out' : d.status}</td>
                <td>{d.ms.toLocaleString('en-GB')} ms</td>
                <td>
                  {d.verifyCalled ? (
                    <span className="cell-ok">
                      <ShieldCheck size={13} aria-hidden="true" /> checked
                    </span>
                  ) : (
                    <span className="cell-tone tone-sig">
                      <ShieldOff size={13} aria-hidden="true" /> not checked
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {verifies.length > 0 && (
        <p className="muted">
          PayPal's verify endpoint answered {verifies.map((v) => v.result).join(', ')}.
        </p>
      )}
          </>
        )}
        renderPayload={() => <pre>{JSON.stringify(entry.event, null, 2)}</pre>}
      />
    </div>
  );
}

type NoticeTab = 'problems' | 'attempts' | 'payload';

/** The selected notice in three tabs, so its problems, its delivery tries and its raw payload each get the whole panel. */
function NoticeTabs({ problems, attempts, renderProblems, renderAttempts, renderPayload }: { problems: number; attempts: number; renderProblems: () => ReactNode; renderAttempts: () => ReactNode; renderPayload: () => ReactNode }) {
  const [tab, setTab] = useState<NoticeTab>(problems > 0 ? 'problems' : 'attempts');
  const tabs: { id: NoticeTab; label: string; icon: LucideIcon; count?: number }[] = [
    { id: 'problems', label: 'Problems', icon: TriangleAlert, count: problems },
    { id: 'attempts', label: 'Attempts', icon: Send, count: attempts },
    { id: 'payload', label: 'Payload', icon: Braces },
  ];
  return (
    <div className="notice-tabs">
      <div className="seg" role="tablist" aria-label="About this notice">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            <Icon size={14} aria-hidden="true" /> {label}
            {count !== undefined && count > 0 && <span className={`count${id === 'problems' ? ' bad' : ''}`}>{count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel">{tab === 'problems' ? renderProblems() : tab === 'attempts' ? renderAttempts() : renderPayload()}</div>
    </div>
  );
}
