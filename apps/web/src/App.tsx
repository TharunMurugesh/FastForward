import type { CheckId } from '@fastforward/contracts';
import { BookOpen, CalendarClock, ChartGantt, CirclePlay, Film, FlaskConical, Hash, Wrench, CircleCheck, Play, FastForward, GitCompareArrows, Hourglass, Info, LayoutDashboard, LoaderCircle, MessagesSquare, Table2, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUG_LABELS, fmtDate, fmtDateYear } from './format.js';
import { DeliveriesGrid } from './grids/DeliveriesGrid.js';
import { FidelityGrid } from './grids/FidelityGrid.js';
import { toDeliveryRows, toNoticeRows } from './grids/rows.js';
import { DisputeChat } from './panels/DisputeChat.js';
import { EventInspector } from './panels/EventInspector.js';
import { FixDrawer } from './panels/FixDrawer.js';
import { Overview, ProblemCard } from './panels/Overview.js';
import { CheckBadge, Story } from './checkLook.js';
import { CustomerCards } from './panels/CustomerCards.js';
import { Skeleton } from './panels/Skeleton.js';
import { disputeThreads } from './panels/thread.js';
import { toTimeline } from './timeline/model.js';
import { Timeline } from './timeline/Timeline.js';
import { useRun } from './useRun.js';
import { useTab, type Tab } from './useTab.js';

const DAY_MS = 86_400_000;

const TAB_LOOK: Record<Tab, { label: string; icon: LucideIcon }> = {
  overview: { label: 'Overview', icon: LayoutDashboard },
  timeline: { label: 'Timeline', icon: ChartGantt },
  deliveries: { label: 'Deliveries', icon: Table2 },
  disputes: { label: 'Disputes', icon: MessagesSquare },
  match: { label: 'PayPal match', icon: GitCompareArrows },
};

export function App() {
  const run = useRun();
  const [tab, openTab] = useTab();
  const [selected, setSelected] = useState<string | null>(null);
  const [checkFilter, setCheckFilter] = useState<CheckId | null>(null);
  const [explaining, setExplaining] = useState<CheckId | null>(null);

  const { info, trace, report, start, mode } = run;
  const subs = info.subscriptions;
  const rows = useMemo(() => toDeliveryRows(trace, subs, report ?? undefined), [trace, subs, report]);
  const notices = useMemo(() => toNoticeRows(rows), [rows]);
  const model = useMemo(() => toTimeline(trace, subs), [trace, subs]);
  const disputes = useMemo(() => disputeThreads(trace, subs).length, [trace, subs]);
  const failed = report?.checks.filter((c) => c.status === 'fail').length ?? 0;
  const disputeCheck = report?.checks.find((c) => c.id === 'DISPUTE_ANSWERED');
  const disputeHelp = disputeCheck?.status === 'fail' ? disputeCheck.findings.find((f) => f.fix || f.explanation) : undefined;

  const select = useCallback((eventId: string | null) => setSelected(eventId), []);
  // Until something is picked, the side panel opens on the first problem notice rather than standing empty.
  const shown = useMemo(() => {
    if (selected) return selected;
    const first = notices.find((n) => (checkFilter ? n.failedChecks.includes(checkFilter) : n.failedChecks.length > 0)) ?? notices[0];
    return first?.eventId ?? null;
  }, [selected, notices, checkFilter]);
  // From the overview's timeline: the same notice on the timeline tab.
  const openOnTimeline = useCallback(
    (eventId: string) => {
      setSelected(eventId);
      openTab('timeline');
      window.scrollTo({ top: 0 });
    },
    [openTab],
  );

  // From a problem card or the fix drawer: the table, narrowed to that problem's notices.
  const showNotices = useCallback(
    (check: CheckId) => {
      setExplaining(null);
      setSelected(null);
      setCheckFilter(check);
      openTab('deliveries');
      window.scrollTo({ top: 0 });
    },
    [openTab],
  );
  const openNotice = useCallback(
    (eventId: string) => {
      setExplaining(null);
      setSelected(eventId);
      openTab('deliveries');
    },
    [openTab],
  );
  const closeDrawer = useCallback(() => setExplaining(null), []);

  // The scrubber: show the dragged value at once, tell the run once the hand stops.
  const [dragging, setDragging] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const live = mode === 'live';
  const loading = mode === 'loading';
  const min = Date.parse(start);
  const max = Date.parse(info.end);
  const value = dragging ?? Date.parse(info.now);
  const onScrub = (raw: number) => {
    // A live run's clock only moves forward.
    const ms = live ? Math.max(raw, Date.parse(info.now)) : raw;
    setDragging(ms);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDragging(null);
      run.moveTo(new Date(ms).toISOString());
    }, live ? 350 : 60);
  };
  const atEnd = Date.parse(info.now) >= max;
  const finished = live && atEnd;

  const count: Partial<Record<Tab, number>> = { overview: failed, deliveries: notices.length, disputes };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <FastForward size={22} strokeWidth={2.4} />
          </span>
          <div>
            <h1>Fastforward</h1>
            <p className="muted small">A month of PayPal billing in seconds</p>
          </div>
        </div>

        <nav className="sidenav" role="tablist" aria-label="Sections" aria-orientation="vertical">
          {(Object.keys(TAB_LOOK) as Tab[]).map((t) => {
            const { label, icon: Icon } = TAB_LOOK[t];
            const n = count[t];
            return (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => openTab(t)}>
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {!loading && n !== undefined && n > 0 && <span className={`count${t === 'overview' ? ' bad' : ''}`}>{n}</span>}
              </button>
            );
          })}
        </nav>

        {/* The clock lives here, beside every page; a finished live run has nothing left to move. */}
        {!finished && (
          <section className="time" aria-label="Time control">
            <span className="clock-label">
              <CalendarClock size={14} aria-hidden="true" /> Virtual date
            </span>
            <strong className="clock-date">{loading ? <span className="bone" style={{ width: 120, height: 24 }} /> : fmtDateYear(new Date(value).toISOString())}</strong>
            <input
              type="range"
              min={min}
              max={max}
              step={DAY_MS}
              value={Math.min(Math.max(value, min), max)}
              onChange={(e) => onScrub(Number(e.target.value))}
              aria-label="Move through the run's virtual time"
              disabled={loading}
            />
            <div className="scrub-ends muted">
              <span>{loading ? '' : fmtDate(new Date(min).toISOString())}</span>
              <span>{loading ? '' : fmtDate(info.end)}</span>
            </div>
            <p className="muted small">{live ? 'Time only moves forward in a live run.' : 'Drag to replay the recording.'}</p>
            <div className="time-buttons">
              <button type="button" onClick={() => run.moveBy(1)} disabled={loading || atEnd}>
                +1 day
              </button>
              <button type="button" onClick={() => run.moveBy(7)} disabled={loading || atEnd}>
                +1 week
              </button>
              <button type="button" className="primary" onClick={run.toEnd} disabled={loading || atEnd}>
                <Play size={15} aria-hidden="true" /> Run to end
              </button>
            </div>
          </section>
        )}

        {finished && report && (
          <section className="run-facts" aria-label="This run">
            <span className="clock-label">
              <CalendarClock size={14} aria-hidden="true" /> This run
            </span>
            <dl>
              {(
                [
                  ['Scenario', report.scenario],
                  ['Simulated', `${fmtDate(report.start)} to ${fmtDate(report.end)}`],
                  ['Customers', report.counts.customers],
                  ['Notices', report.counts.events],
                  ['Deliveries', report.counts.deliveries],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* One row per fact, icon first, so the status reads as a list rather than loose tags. */}
        <ul className="run-status" aria-label="Run status">
          <li className="sim" title="Nothing here is real money or real PayPal traffic">
            <FlaskConical size={14} aria-hidden="true" /> Simulated
          </li>
          {live && (
            <li className="mono" title="This run's id">
              <Hash size={14} aria-hidden="true" /> {info.runId}
            </li>
          )}
          {mode === 'sample' && (
            <li className="warn">
              <Film size={14} aria-hidden="true" /> Sample run
            </li>
          )}
          {finished && (
            <li className="ok">
              <CircleCheck size={14} aria-hidden="true" /> Finished {fmtDate(info.end)}
            </li>
          )}
          {live && !finished && !run.busy && (
            <li className="info">
              <CirclePlay size={14} aria-hidden="true" /> In progress
            </li>
          )}
          {run.busy && (
            <li className="info">
              <LoaderCircle size={14} className="spin" aria-hidden="true" /> Working
            </li>
          )}
        </ul>
      </aside>

      <div className="page">

      {mode === 'sample' && run.note && run.sample && (
        <div className="banner" role="status">
          <Info size={18} aria-hidden="true" />
          <div>
            <p>
              <strong>Sample run.</strong> {run.note} This is a recording of <strong>{run.sample.scenario}</strong> against Coffee Club, taken {fmtDateYear(run.sample.recordedAt)}.{' '}
              {run.ended && <a href="/">Open the current run</a>}
            </p>
            <details>
              <summary>What was broken on purpose</summary>
              <ul>
                {run.sample.bugs.map((b) => (
                  <li key={b}>{BUG_LABELS[b] ?? b}</li>
                ))}
              </ul>
            </details>
          </div>
        </div>
      )}

      <h2 className="page-title">{TAB_LOOK[tab].label}</h2>

      <main role="tabpanel" aria-label={TAB_LOOK[tab].label}>
        {loading && tab !== 'match' ? (
          <Skeleton shape={tab === 'overview' ? 'overview' : tab === 'timeline' ? 'timeline' : 'table'} />
        ) : (
          <>
            {tab === 'overview' &&
              (report ? (
                <Overview report={report} notices={notices} trace={trace} subscriptions={subs} onExplain={setExplaining} onShowNotices={showNotices}>
                  <header className="section-head">
                    <h2>How the month went</h2>
                    <p className="muted">One line per customer. Click a marker to open that notice.</p>
                  </header>
                  <Timeline model={model} range={{ start, end: info.end }} now={info.now} selectedEventId={null} onSelect={openOnTimeline} />
                </Overview>
              ) : (
                <section className="card empty-state">
                  <Hourglass size={32} aria-hidden="true" />
                  <h2>No verdict yet</h2>
                  <p className="muted">The checks look at the whole run. Press "Run to end" to see how your app did.</p>
                </section>
              ))}
            {tab === 'timeline' && (
              <div className="main">
                <div className="stack">
                  <header className="section-head">
                    <h2>Each customer's month</h2>
                    <p className="muted">One line per customer. Click a marker to see that notice.</p>
                  </header>
                  <Timeline model={model} range={{ start, end: info.end }} now={info.now} selectedEventId={shown} onSelect={select} />
                  <header className="section-head">
                    <h2>Customers</h2>
                    <p className="muted">What happened to each one, and which problems hit them.</p>
                  </header>
                  <CustomerCards model={model} notices={notices} onShowCustomer={select} />
                </div>
                <aside className="card side" aria-label="Selected notice">
                  <EventInspector eventId={shown} trace={trace} subscriptions={subs} report={report} />
                </aside>
              </div>
            )}
            {tab === 'deliveries' && (
              <div className="main">
                <DeliveriesGrid rows={rows} notices={notices} selectedEventId={shown} onSelect={select} checkFilter={checkFilter} onClearCheck={() => setCheckFilter(null)} />
                <aside className="card side" aria-label="Selected notice">
                  <EventInspector eventId={shown} trace={trace} subscriptions={subs} report={report} />
                </aside>
              </div>
            )}
            {tab === 'disputes' && (
              <div className="main wide-side">
                <div className="stack">
                  <section className="card" aria-label="Disputes">
                    <DisputeChat trace={trace} subscriptions={subs} />
                  </section>
                  <section className="card" aria-label="What a correct app does">
                    <header className="section-head">
                      <h2>What a correct app does</h2>
                      <p className="muted">The seller only keeps the money by answering before the reply-by date.</p>
                    </header>
                    <Story id="DISPUTE_ANSWERED" remedy />
                  </section>
                  {disputeHelp?.fix && (
                    <section className="card drawer-body inline" aria-label="The fix">
                      <div className="drawer-section fix">
                        <h3>
                          <Wrench size={16} aria-hidden="true" /> The fix
                        </h3>
                        <p>{disputeHelp.fix}</p>
                      </div>
                      {disputeHelp.explanation && (
                        <div className="drawer-section">
                          <h3>
                            <BookOpen size={16} aria-hidden="true" /> What happened in this run
                          </h3>
                          <p>{disputeHelp.explanation}</p>
                        </div>
                      )}
                    </section>
                  )}
                </div>
                {disputeCheck?.status === 'fail' ? (
                  <ProblemCard check={disputeCheck} notices={notices} trace={trace} subscriptions={subs} onExplain={setExplaining} onShowNotices={showNotices} />
                ) : (
                  <aside className="card side-note">
                    <CheckBadge id="DISPUTE_ANSWERED" size="lg" />
                    <h3>{disputeCheck?.status === 'pass' ? 'Every dispute was answered in time' : 'Disputes are checked at the end of the run'}</h3>
                    <p className="muted">When a customer disputes a payment, your app has until the due date to reply through PayPal's disputes API. Silence means the buyer wins.</p>
                  </aside>
                )}
              </div>
            )}
          </>
        )}
        {tab === 'match' && <FidelityGrid file={run.fidelity} isSample={run.fidelityIsSample} />}
      </main>

      <FixDrawer check={explaining} report={report} onClose={closeDrawer} onOpenNotice={openNotice} onShowNotices={showNotices} />

      <footer className="foot muted">
        Fastforward is a simulator. Webhooks carry an <code>X-Fastforward-Run</code> header and nothing here touches live PayPal.
      </footer>
      </div>
    </div>
  );
}
