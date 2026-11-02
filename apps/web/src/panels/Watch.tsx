import { ArrowRight, Bot, CalendarClock, FastForward, FlaskConical, Landmark, Radio, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtDateYear } from '../format.js';
import { realSteps, type RealRunFile } from '../realRun.js';
import type { FeedItem } from '../watch.js';

const REAL_STEP_MS = 1100;
const DAY_STEP_MS = 180;
const DAY_MS = 86_400_000;

interface Props {
  realRun: RealRunFile | null;
  start: string;
  end: string;
  now: string;
  feed: FeedItem[];
  moveTo: (iso: string) => void;
  onDone: () => void;
}

/** Step 2: the recorded real run first, then the simulated months, so you see the test happen before you see a verdict. */
export function Watch({ realRun, start, end, now, feed, moveTo, onDone }: Props) {
  const steps = useMemo(() => (realRun ? realSteps(realRun).filter((s) => !s.opensTimeline) : []), [realRun]);
  const [shown, setShown] = useState(0);
  const moveRef = useRef(moveTo);
  moveRef.current = moveTo;
  const realDone = shown >= steps.length;
  const finished = realDone && Date.parse(now) >= Date.parse(end);

  useEffect(() => {
    moveRef.current(start);
  }, [start]);

  useEffect(() => {
    if (realDone) return;
    const timer = setTimeout(() => setShown((n) => n + 1), REAL_STEP_MS);
    return () => clearTimeout(timer);
  }, [realDone, shown]);

  useEffect(() => {
    if (!realDone || finished) return;
    const timer = setTimeout(() => moveRef.current(new Date(Math.min(Date.parse(now) + DAY_MS, Date.parse(end))).toISOString()), DAY_STEP_MS);
    return () => clearTimeout(timer);
  }, [realDone, finished, now, end]);

  const total = Date.parse(end) - Date.parse(start);
  const progress = total > 0 ? Math.round(((Date.parse(now) - Date.parse(start)) / total) * 100) : 0;

  return (
    <div className="watch">
      <section className="card watch-real" aria-label="On the real sandbox">
        <header className="watch-head">
          <span className="chip info">
            <Landmark size={14} aria-hidden="true" /> Real sandbox
          </span>
          <h2>First, on PayPal's sandbox</h2>
        </header>
        {steps.length === 0 && <p className="muted">No real run has been recorded yet.</p>}
        <ol className="watch-steps">
          {steps.slice(0, shown).map((s, i) => (
            <li key={i} className={s.source}>
              {s.source === 'real' ? <Landmark size={16} aria-hidden="true" /> : <FlaskConical size={16} aria-hidden="true" />}
              <div>
                <strong>{s.title}</strong>
                <span className="muted small">
                  {s.source === 'real' ? 'Real sandbox' : 'Simulated'}: {s.detail}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="card watch-months" aria-label="The simulated months">
        <header className="watch-head">
          <span className="chip neutral">
            <FlaskConical size={14} aria-hidden="true" /> Simulated
          </span>
          <h2>Then, the months the sandbox cannot reach</h2>
        </header>
        <div className="watch-clock">
          <CalendarClock size={26} aria-hidden="true" />
          <strong>{realDone ? fmtDateYear(now) : 'Waiting for the sandbox part'}</strong>
          <span className="muted small">
            {fmtDate(start)} to {fmtDate(end)}
          </span>
        </div>
        <div className="watch-bar" role="progressbar" aria-valuenow={realDone ? progress : 0} aria-valuemin={0} aria-valuemax={100} aria-label="How far through the months">
          <span style={{ width: `${realDone ? progress : 0}%` }} />
        </div>
        <ul className="watch-feed">
          {realDone &&
            feed.slice(0, 7).map((f) => (
              <li key={f.key} className={f.failed ? 'failed' : ''}>
                {f.kind === 'decision' ? <Bot size={16} aria-hidden="true" /> : f.failed ? <TriangleAlert size={16} aria-hidden="true" /> : <Radio size={16} aria-hidden="true" />}
                <div>
                  <strong>{f.title}</strong>
                  <span className="muted small">
                    {fmtDate(f.at)}, {f.detail}
                  </span>
                </div>
              </li>
            ))}
        </ul>
      </section>
      <div className="watch-actions">
        {finished ? (
          <button type="button" className="primary" onClick={onDone}>
            See the result <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" onClick={onDone}>
            <FastForward size={16} aria-hidden="true" /> Skip to the result
          </button>
        )}
      </div>
    </div>
  );
}
