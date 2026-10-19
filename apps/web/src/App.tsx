import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtDateYear } from './format.js';
import { DeliveriesGrid } from './grids/DeliveriesGrid.js';
import { FidelityGrid } from './grids/FidelityGrid.js';
import { toDeliveryRows } from './grids/rows.js';
import { DisputeChat } from './panels/DisputeChat.js';
import { EventInspector } from './panels/EventInspector.js';
import { ReportPanel } from './panels/ReportPanel.js';
import { toTimeline } from './timeline/model.js';
import { Timeline } from './timeline/Timeline.js';
import { useRun } from './useRun.js';

type Tab = 'report' | 'event' | 'dispute';
const DAY_MS = 86_400_000;

export function App() {
  const run = useRun();
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('report');

  const { info, trace, report, start, mode } = run;
  const subs = info.subscriptions;
  const rows = useMemo(() => toDeliveryRows(trace, subs, report ?? undefined), [trace, subs, report]);
  const model = useMemo(() => toTimeline(trace, subs), [trace, subs]);
  const failed = report?.checks.filter((c) => c.status === 'fail').length ?? 0;

  const select = useCallback((eventId: string | null) => {
    setSelected(eventId);
    if (eventId) setTab('event');
  }, []);

  // The scrubber: show the dragged value at once, tell the run once the hand stops.
  const [dragging, setDragging] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const live = mode === 'live';
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

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ⏩
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
          {mode === 'live' && <span className="chip ok">Live run {info.runId}</span>}
          {mode === 'sample' && <span className="chip warn">Sample run</span>}
          {run.busy && <span className="chip neutral">Working…</span>}
        </div>
      </header>

      {mode === 'sample' && run.note && (
        <p className="banner" role="status">
          {run.note} Everything below is recorded sample data of the <strong>bad-month</strong> scenario against a deliberately buggy Coffee Club, so you can try the screen.
        </p>
      )}

      <section className="card controls" aria-label="Time control">
        <div className="clock">
          <span className="clock-label">Virtual date</span>
          <strong className="clock-date">{fmtDateYear(new Date(value).toISOString())}</strong>
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
            disabled={mode === 'loading' || (live && atEnd)}
          />
          <div className="scrub-ends muted">
            <span>{fmtDate(new Date(min).toISOString())}</span>
            <span>{live ? 'Time only moves forward in a live run' : 'Drag to replay'}</span>
            <span>{fmtDate(info.end)}</span>
          </div>
        </div>
        <div className="buttons">
          <button type="button" onClick={() => run.moveBy(1)} disabled={atEnd}>
            +1 day
          </button>
          <button type="button" onClick={() => run.moveBy(7)} disabled={atEnd}>
            +1 week
          </button>
          <button type="button" className="primary" onClick={run.toEnd} disabled={atEnd}>
            Run to end
          </button>
        </div>
      </section>

      <Timeline model={model} range={{ start, end: info.end }} now={info.now} selectedEventId={selected} onSelect={select} />

      <div className="main">
        <DeliveriesGrid rows={rows} selectedEventId={selected} onSelect={select} />
        <aside className="card side" aria-label="Details">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'report'} className={tab === 'report' ? 'on' : ''} onClick={() => setTab('report')}>
              Report {failed > 0 && <span className="count bad">{failed}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'event'} className={tab === 'event' ? 'on' : ''} onClick={() => setTab('event')}>
              Event
            </button>
            <button role="tab" aria-selected={tab === 'dispute'} className={tab === 'dispute' ? 'on' : ''} onClick={() => setTab('dispute')}>
              Dispute
            </button>
          </div>
          <div className="tab-body" role="tabpanel">
            {tab === 'report' && <ReportPanel report={report} onSelect={select} />}
            {tab === 'event' && <EventInspector eventId={selected} trace={trace} subscriptions={subs} report={report} />}
            {tab === 'dispute' && <DisputeChat trace={trace} subscriptions={subs} />}
          </div>
        </aside>
      </div>

      <FidelityGrid file={run.fidelity} isSample={run.fidelityIsSample} />

      <footer className="foot muted">
        Fastforward is a simulator. Webhooks carry an <code>X-Fastforward-Run</code> header and nothing here touches live PayPal.
      </footer>
    </div>
  );
}
