import type { CheckId } from '@fastforward/contracts';
import { ArrowRight, BookOpen, CalendarClock, ChartGantt, ChevronRight, Eye, FastForward, FlaskConical, GitCompareArrows, Hourglass, Info, Landmark, ListChecks, MessagesSquare, Microscope, Play, Table2, Wrench, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUG_LABELS, fmtDate, fmtDateYear } from './format.js';
import { DeliveriesGrid } from './grids/DeliveriesGrid.js';
import { FidelityGrid } from './grids/FidelityGrid.js';
import { toDeliveryRows, toNoticeRows } from './grids/rows.js';
import { Choose } from './panels/Choose.js';
import { DisputeChat } from './panels/DisputeChat.js';
import { EventInspector } from './panels/EventInspector.js';
import { FixDrawer } from './panels/FixDrawer.js';
import { Overview, ProblemCard } from './panels/Overview.js';
import { RealRun } from './panels/RealRun.js';
import { Watch } from './panels/Watch.js';
import { CheckBadge, Story } from './checkLook.js';
import { CustomerCards } from './panels/CustomerCards.js';
import { Skeleton } from './panels/Skeleton.js';
import { disputeThreads } from './panels/thread.js';
import { toTimeline } from './timeline/model.js';
import { Timeline } from './timeline/Timeline.js';
import { api } from './api.js';
import { useRun } from './useRun.js';
import { useTab, TABS, type Tab } from './useTab.js';
import { watchFeed } from './watch.js';

const DAY_MS = 86_400_000;

const STEPS: Record<Tab, { label: string; icon: LucideIcon }> = {
  choose: { label: 'Choose', icon: Play },
  watch: { label: 'Watch', icon: Eye },
  result: { label: 'Result', icon: ListChecks },
  details: { label: 'Details', icon: Microscope },
};

type Detail = 'deliveries' | 'timeline' | 'disputes' | 'real' | 'match';

const DETAILS: Record<Detail, { label: string; icon: LucideIcon; source: 'real' | 'simulated'; note: string }> = {
  deliveries: { label: 'Notices', icon: Table2, source: 'simulated', note: 'Every notice the stand-in for PayPal sent the demo shop, and how the shop answered.' },
  timeline: { label: 'Timeline', icon: ChartGantt, source: 'simulated', note: 'The months, customer by customer. Move through them with the clock.' },
  disputes: { label: 'Disputes', icon: MessagesSquare, source: 'simulated', note: "The customer's words were written by Claude. The sandbox API cannot open a dispute." },
  real: { label: 'Real sandbox', icon: Landmark, source: 'real', note: "A recorded run on PayPal's real sandbox." },
  match: { label: 'PayPal match', icon: GitCompareArrows, source: 'real', note: "The same requests sent to PayPal's real sandbox and to our stand-in, then compared." },
};

export function App() {
  const run = useRun();
  const [tab, openTab] = useTab();
  const [detail, setDetail] = useState<Detail>('deliveries');
  const [selected, setSelected] = useState<string | null>(null);
  const [checkFilter, setCheckFilter] = useState<CheckId | null>(null);
  const [explaining, setExplaining] = useState<CheckId | null>(null);
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const embedded = params.has('embed');
  const bugsOff = params.get('bugs') === 'off';
  // On this machine (`npm run demo`) the test is played afresh; the public site only replays.
  const [local, setLocal] = useState<{ bugsOn: boolean } | null>(null);
  const [localRunning, setLocalRunning] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => {
    void api.local().then((l) => l && setLocal({ bugsOn: !bugsOff }));
  }, [bugsOff]);
  const startTest = useCallback(async () => {
    if (!local) {
      openTab('watch');
      return;
    }
    setLocalRunning(true);
    setLocalError(null);
    try {
      const runId = await api.localRun(local.bugsOn);
      window.location.href = `/?run=${encodeURIComponent(runId)}${embedded ? '&embed=1' : ''}${local.bugsOn ? '' : '&bugs=off'}#watch`;
    } catch (err) {
      setLocalError((err as Error).message);
      setLocalRunning(false);
    }
  }, [local, embedded, openTab]);

  const { info, trace, report, start, mode } = run;
  const subs = info.subscriptions;
  const rows = useMemo(() => toDeliveryRows(trace, subs, report ?? undefined), [trace, subs, report]);
  const notices = useMemo(() => toNoticeRows(rows), [rows]);
  const model = useMemo(() => toTimeline(trace, subs), [trace, subs]);
  const feed = useMemo(() => watchFeed(notices, trace), [notices, trace]);
  const disputes = useMemo(() => disputeThreads(trace, subs).length, [trace, subs]);
  const disputeCheck = report?.checks.find((c) => c.id === 'DISPUTE_ANSWERED');
  const disputeHelp = disputeCheck?.status === 'fail' ? disputeCheck.findings.find((f) => f.fix || f.explanation) : undefined;

  const select = useCallback((eventId: string | null) => setSelected(eventId), []);
  // Until something is picked, the side panel opens on the first problem notice rather than standing empty.
  const shown = useMemo(() => {
    if (selected) return selected;
    const first = notices.find((n) => (checkFilter ? n.failedChecks.includes(checkFilter) : n.failedChecks.length > 0)) ?? notices[0];
    return first?.eventId ?? null;
  }, [selected, notices, checkFilter]);

  const openDetail = useCallback(
    (next: Detail) => {
      setDetail(next);
      openTab('details');
      window.scrollTo({ top: 0 });
    },
    [openTab],
  );
  const { toEnd } = run;
  const toResult = useCallback(() => {
    toEnd();
    openTab('result');
    window.scrollTo({ top: 0 });
  }, [toEnd, openTab]);
  // From a problem card or the fix drawer: the table, narrowed to that problem's notices.
  const showNotices = useCallback(
    (check: CheckId) => {
      setExplaining(null);
      setSelected(null);
      setCheckFilter(check);
      openDetail('deliveries');
    },
    [openDetail],
  );
  const openNotice = useCallback(
    (eventId: string) => {
      setExplaining(null);
      setSelected(eventId);
      openDetail('deliveries');
    },
    [openDetail],
  );
  const closeDrawer = useCallback(() => setExplaining(null), []);

  // The scrubber: show the dragged value at once, tell the run once the hand stops.
  const [dragging, setDragging] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const live = mode === 'live';
  // Only a live run still in progress moves the twin's clock, which only goes forward; a finished one is replayed in the page.
  const forwardOnly = live && !run.complete;
  const loading = mode === 'loading';
  const min = Date.parse(start);
  const max = Date.parse(info.end);
  const value = dragging ?? Date.parse(info.now);
  const onScrub = (raw: number) => {
    const ms = forwardOnly ? Math.max(raw, Date.parse(info.now)) : raw;
    setDragging(ms);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDragging(null);
      run.moveTo(new Date(ms).toISOString());
    }, forwardOnly ? 350 : 60);
  };
  const atEnd = Date.parse(info.now) >= max;

  const timeControls = (
    <section className="card time-bar" aria-label="Time control">
      <div className="clock">
        <span className="clock-label">
          <CalendarClock size={14} aria-hidden="true" /> Virtual date
        </span>
        <strong className="clock-date">{fmtDateYear(new Date(value).toISOString())}</strong>
      </div>
      <div className="scrub">
        <input type="range" min={min} max={max} step={DAY_MS} value={Math.min(Math.max(value, min), max)} onChange={(e) => onScrub(Number(e.target.value))} aria-label="Move through the run's virtual time" disabled={loading} />
        <div className="scrub-ends muted">
          <span>{fmtDate(new Date(min).toISOString())}</span>
          <span>{forwardOnly ? 'Time only moves forward in a live run' : 'Drag or step to replay any day'}</span>
          <span>{fmtDate(info.end)}</span>
        </div>
      </div>
      <div className="time-buttons">
        <button type="button" onClick={() => run.moveBy(1)} disabled={loading || atEnd}>
          +1 day
        </button>
        <button type="button" onClick={() => run.moveBy(7)} disabled={loading || atEnd}>
          +1 week
        </button>
        <button type="button" className="primary" onClick={toEnd} disabled={loading || atEnd}>
          <Play size={15} aria-hidden="true" /> Run to end
        </button>
      </div>
    </section>
  );

  const reached = TABS.indexOf(tab);

  return (
    <div className={`app${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <header className="app-top">
          <span className="logo" aria-hidden="true">
            <FastForward size={22} strokeWidth={2.4} />
          </span>
          <div>
            <h1>Test Clock</h1>
            <p className="muted small">A proposal for PayPal's developer dashboard. Not a PayPal product.</p>
          </div>
        </header>
      )}

      <nav className="stepper" aria-label="Steps">
        {TABS.map((t, i) => {
          const { label, icon: Icon } = STEPS[t];
          return (
            <span key={t} className="step-wrap">
              {i > 0 && <ChevronRight size={16} className="muted" aria-hidden="true" />}
              <button type="button" className={`${tab === t ? 'on' : ''}${i < reached ? ' done' : ''}`} aria-current={tab === t ? 'step' : undefined} onClick={() => (t === 'result' ? toResult() : openTab(t))}>
                <span className="step-n">{i + 1}</span>
                <Icon size={16} aria-hidden="true" />
                {label}
              </button>
            </span>
          );
        })}
      </nav>

      <div className="page">
        {mode === 'sample' && run.note && run.sample && tab !== 'watch' && (
          <div className="banner" role="status">
            <Info size={18} aria-hidden="true" />
            <div>
              <p>
                <strong>Sample run.</strong> {run.note} This is a recording of <strong>{run.sample.scenario}</strong> against Coffee Club, taken {fmtDateYear(run.sample.recordedAt)}. {run.ended && <a href="/">Open the current run</a>}
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

        <main aria-label={STEPS[tab].label}>
          {tab === 'choose' && (
            <Choose
              report={run.report}
              disabled={loading}
              local={local && { bugsOn: local.bugsOn, setBugsOn: (on) => setLocal({ bugsOn: on }), running: localRunning, error: localError }}
              onStart={() => void startTest()}
            />
          )}

          {tab === 'watch' && (loading ? <Skeleton shape="timeline" /> : <Watch realRun={run.realRun} start={start} end={info.end} now={info.now} feed={feed} moveTo={run.moveTo} onDone={toResult} />)}

          {tab === 'result' &&
            (loading ? (
              <Skeleton shape="overview" />
            ) : report ? (
              <div className="stack">
                <p className="match-note">
                  <Info size={18} aria-hidden="true" />
                  {report.checks.some((c) => c.status === 'fail') ? (
                    <span>
                      <strong>These failures come from bugs we planted in the demo shop.</strong> The checks really ran against it, over simulated months. With your own app, they would be your bugs.
                    </span>
                  ) : (
                    <span>
                      <strong>Nothing failed.</strong> {bugsOff ? 'This run had the planted bugs switched off: the same month, the same customers, the same bad weather.' : 'Every check passed in this run.'}
                    </span>
                  )}
                </p>
                <Overview report={report} notices={notices} trace={trace} subscriptions={subs} onExplain={setExplaining} onShowNotices={showNotices} />
                <div className="watch-actions">
                  <button type="button" className="primary" onClick={() => openDetail('deliveries')}>
                    See the details <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            ) : (
              <section className="card empty-state">
                <Hourglass size={32} aria-hidden="true" />
                <h2>No verdict yet</h2>
                <p className="muted">The checks look at the whole run, so the result appears once it has finished.</p>
              </section>
            ))}

          {tab === 'details' && (
            <div className="stack">
              <div className="detail-tabs" role="tablist" aria-label="Details">
                {(Object.keys(DETAILS) as Detail[]).map((d) => {
                  const { label, icon: Icon } = DETAILS[d];
                  return (
                    <button key={d} type="button" role="tab" aria-selected={detail === d} className={detail === d ? 'on' : ''} onClick={() => setDetail(d)}>
                      <Icon size={16} aria-hidden="true" /> {label}
                    </button>
                  );
                })}
              </div>
              <p className="detail-note">
                <span className={`chip ${DETAILS[detail].source === 'real' ? 'info' : 'neutral'}`}>
                  {DETAILS[detail].source === 'real' ? <Landmark size={14} aria-hidden="true" /> : <FlaskConical size={14} aria-hidden="true" />}
                  {DETAILS[detail].source === 'real' ? 'Real sandbox' : 'Simulated'}
                </span>
                <span className="muted">{DETAILS[detail].note}</span>
              </p>

              {loading && detail !== 'match' && detail !== 'real' ? (
                <Skeleton shape={detail === 'timeline' ? 'timeline' : 'table'} />
              ) : (
                <>
                  {detail === 'deliveries' && (
                    <div className="main">
                      <DeliveriesGrid rows={rows} notices={notices} selectedEventId={shown} onSelect={select} checkFilter={checkFilter} onClearCheck={() => setCheckFilter(null)} />
                      <aside className="card side" aria-label="Selected notice">
                        <EventInspector eventId={shown} trace={trace} subscriptions={subs} report={report} />
                      </aside>
                    </div>
                  )}
                  {detail === 'timeline' && (
                    <div className="main">
                      <div className="stack">
                        {timeControls}
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
                  {detail === 'disputes' && (
                    <div className="main wide-side">
                      <div className="stack">
                        <section className="card" aria-label="Disputes">
                          {disputes > 0 ? <DisputeChat trace={trace} subscriptions={subs} /> : <p className="muted">No dispute in this run.</p>}
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
                  {detail === 'real' && <RealRun report={run.realRun} onOpenTimeline={() => setDetail('timeline')} />}
                  {detail === 'match' && <FidelityGrid file={run.fidelity} isSample={run.fidelityIsSample} />}
                </>
              )}
            </div>
          )}
        </main>

        <FixDrawer check={explaining} report={report} onClose={closeDrawer} onOpenNotice={openNotice} onShowNotices={showNotices} />

        {!embedded && <footer className="foot muted">Open source. Sandbox and simulator only: nothing here touches live PayPal or real money.</footer>}
      </div>
    </div>
  );
}
