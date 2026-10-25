import type { CheckId } from '@fastforward/contracts';
import { ChartGantt, CircleCheck, FastForward, GitCompareArrows, Hourglass, Info, LayoutDashboard, LoaderCircle, MessagesSquare, Table2, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUG_LABELS, fmtDate, fmtDateYear } from './format.js';
import { DeliveriesGrid } from './grids/DeliveriesGrid.js';
import { FidelityGrid } from './grids/FidelityGrid.js';
import { toDeliveryRows, toNoticeRows } from './grids/rows.js';
import { DisputeChat } from './panels/DisputeChat.js';
import { EventInspector } from './panels/EventInspector.js';
import { FixDrawer } from './panels/FixDrawer.js';
import { Overview } from './panels/Overview.js';
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

  const select = useCallback((eventId: string | null) => setSelected(eventId), []);

  // From a problem card or the fix drawer: the table, narrowed to that problem's notices.
  const showNotices = useCallback(
    (check: CheckId) => {
      setExplaining(null);
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
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            <FastForward size={22} strokeWidth={2.4} />
          </span>
          <div>
            <h1>Fastforward</h1>
            <p className="muted">Run a month of PayPal billing against your app in seconds</p>
          </div>
        </div>
        <div className="top-chips">
          <span className="chip badge-sim" title="Nothing here is real money or real PayPal traffic">
            Simulated
          </span>
          {live && <span className="chip neutral mono">{info.runId}</span>}
          {finished && (
            <span className="chip ok">
              <CircleCheck size={13} aria-hidden="true" /> Finished {fmtDate(info.end)}
            </span>
          )}
          {mode === 'sample' && <span className="chip warn">Sample run</span>}
          {run.busy && (
            <span className="chip neutral">
              <LoaderCircle size={13} className="spin" aria-hidden="true" /> Working
            </span>
          )}
        </div>
      </header>

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

      <nav className="tabbar" role="tablist" aria-label="Sections">
        {(Object.keys(TAB_LOOK) as Tab[]).map((t) => {
          const { label, icon: Icon } = TAB_LOOK[t];
          const n = count[t];
          return (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => openTab(t)}>
              <Icon size={16} aria-hidden="true" />
              <span>{label}</span>
              {!loading && n !== undefined && n > 0 && <span className={`count${t === 'overview' ? ' bad' : ''}`}>{n}</span>}
            </button>
          );
        })}
      </nav>

      {tab !== 'match' && !finished && (
        <section className="card controls" aria-label="Time control">
          <div className="clock">
            <span className="clock-label">Virtual date</span>
            <strong className="clock-date">{loading ? <span className="bone" style={{ width: 120, height: 24 }} /> : fmtDateYear(new Date(value).toISOString())}</strong>
          </div>
          <div className="scrub">
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
              <span>{live ? 'Time only moves forward in a live run' : 'Drag to replay'}</span>
              <span>{loading ? '' : fmtDate(info.end)}</span>
            </div>
          </div>
          <div className="buttons">
            <button type="button" onClick={() => run.moveBy(1)} disabled={loading || atEnd}>
              +1 day
            </button>
            <button type="button" onClick={() => run.moveBy(7)} disabled={loading || atEnd}>
              +1 week
            </button>
            <button type="button" className="primary" onClick={run.toEnd} disabled={loading || atEnd}>
              Run to end
            </button>
          </div>
        </section>
      )}

      <main role="tabpanel" aria-label={TAB_LOOK[tab].label}>
        {loading && tab !== 'match' ? (
          <Skeleton shape={tab === 'overview' ? 'overview' : tab === 'timeline' ? 'timeline' : 'table'} />
        ) : (
          <>
            {tab === 'overview' &&
              (report ? (
                <Overview report={report} notices={notices} trace={trace} subscriptions={subs} onExplain={setExplaining} onShowNotices={showNotices} />
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
                  <Timeline model={model} range={{ start, end: info.end }} now={info.now} selectedEventId={selected} onSelect={select} />
                </div>
                <aside className="card side" aria-label="Selected notice">
                  <EventInspector eventId={selected} trace={trace} subscriptions={subs} report={report} />
                </aside>
              </div>
            )}
            {tab === 'deliveries' && (
              <div className="main">
                <DeliveriesGrid rows={rows} notices={notices} selectedEventId={selected} onSelect={select} checkFilter={checkFilter} onClearCheck={() => setCheckFilter(null)} />
                <aside className="card side" aria-label="Selected notice">
                  <EventInspector eventId={selected} trace={trace} subscriptions={subs} report={report} />
                </aside>
              </div>
            )}
            {tab === 'disputes' && (
              <section className="card disputes" aria-label="Disputes">
                <DisputeChat trace={trace} subscriptions={subs} />
              </section>
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
  );
}
