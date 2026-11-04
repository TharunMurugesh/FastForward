import { ArrowRight, Ban, Bot, CalendarClock, CircleDollarSign, CirclePause, CirclePlay, CirclePlus, CreditCard, FastForward, Flag, FlaskConical, Hourglass, Landmark, Radio, type LucideIcon } from 'lucide-react';
import { CheckChip, CHECK_LOOK } from '../checkLook.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtDateYear } from '../format.js';
import { realSteps, type RealRunFile } from '../realRun.js';
import type { FeedItem } from '../watch.js';

const REAL_STEP_MS = 1100;

/** One icon per kind of event, the same in every run, so an icon never means "problem". Problems get their own tags. */
function eventIcon(eventType: string): LucideIcon {
  if (eventType === 'PAYMENT.SALE.COMPLETED') return CircleDollarSign;
  if (eventType.endsWith('PAYMENT.FAILED')) return CreditCard;
  if (eventType.endsWith('SUSPENDED')) return CirclePause;
  if (eventType.endsWith('ACTIVATED') || eventType.endsWith('RE-ACTIVATED')) return CirclePlay;
  if (eventType.endsWith('CREATED') && eventType.startsWith('BILLING')) return CirclePlus;
  if (eventType.endsWith('CANCELLED')) return Ban;
  if (eventType.endsWith('EXPIRED')) return Hourglass;
  if (eventType.startsWith('CUSTOMER.DISPUTE')) return Flag;
  return Radio;
}
const DAY_STEP_MS = 180;
const DAY_MS = 86_400_000;

/** Says once what each tag on the feed means, so a tag is never a mystery warning. */
function TagKey({ feed }: { feed: FeedItem[] }) {
  const ids = [...new Set(feed.flatMap((f) => f.problems))];
  if (ids.length === 0) return null;
  return (
    <ul className="watch-tagkey" aria-label="What the tags mean">
      {ids.map((id) => (
        <li key={id}>
          <CheckChip id={id} title={CHECK_LOOK[id].short} />
          <span className="muted">{CHECK_LOOK[id].story[1].text}. The check that judges this fails on the Result step.</span>
        </li>
      ))}
    </ul>
  );
}

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
              {s.source === 'real' ? <Landmark size={20} aria-label="Real sandbox" /> : <FlaskConical size={20} aria-label="Simulated" />}
              <div>
                <strong>{s.title}</strong>
                <span className="muted">{s.detail}</span>
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
            feed.slice(0, 6).map((f) => {
              const Icon = f.kind === 'decision' ? Bot : eventIcon(f.eventType);
              return (
                <li key={f.key} className={f.kind}>
                  <Icon size={20} aria-hidden="true" />
                  <div>
                    <strong>{f.title}</strong>
                    <span className="muted">
                      {fmtDate(f.at)}, {f.detail}
                    </span>
                  </div>
                  {f.problems.length > 0 && (
                    <span className="feed-problems">
                      {f.problems.map((p) => (
                        <CheckChip key={p} id={p} title={`Evidence for: ${CHECK_LOOK[p].short}`} />
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
        </ul>
        {realDone && <TagKey feed={feed.slice(0, 6)} />}
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
