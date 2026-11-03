import type { Report } from '@fastforward/contracts';
import { Bot, Bug, CalendarClock, CircleCheck, CreditCard, Flag, FlaskConical, Landmark, LoaderCircle, Play, Store, UserCheck, Waves } from 'lucide-react';

const CUSTOMERS = [
  { icon: UserCheck, name: 'Maya', text: 'Pays on time' },
  { icon: CreditCard, name: 'Leo', text: 'His card starts failing' },
  { icon: Flag, name: 'Ana', text: 'Says her coffee never came, and disputes' },
  { icon: Waves, name: 'Bad weather', text: 'Notices arrive twice, late, out of order, and one is forged' },
];

interface Props {
  report: Report | null;
  disabled: boolean;
  /** Set only when the demo runs on this machine: then the test is played afresh, with the bugs on or off. */
  local: { bugsOn: boolean; setBugsOn: (on: boolean) => void; running: boolean; error: string | null } | null;
  onStart: () => void;
}

/** Step 1: which app, which test, and what the coming screens will and will not be real. */
export function Choose({ report, disabled, local, onStart }: Props) {
  return (
    <div className="choose">
      <section className="card" aria-label="Your app">
        <h2>Your app</h2>
        <div className="choose-app">
          <Store size={26} aria-hidden="true" />
          <div>
            <strong>Coffee Club</strong>
            <p className="muted">A demo subscription shop we built, with billing bugs planted on purpose. In real use, this is your own app.</p>
          </div>
        </div>
        {local && (
          <div className="bug-switch">
            <span>
              <Bug size={18} aria-hidden="true" /> Planted bugs
            </span>
            <div className="seg" role="group" aria-label="Planted bugs">
              <button type="button" className={local.bugsOn ? 'on' : ''} aria-pressed={local.bugsOn} disabled={local.running} onClick={() => local.setBugsOn(true)}>
                On
              </button>
              <button type="button" className={local.bugsOn ? '' : 'on'} aria-pressed={!local.bugsOn} disabled={local.running} onClick={() => local.setBugsOn(false)}>
                Off
              </button>
            </div>
          </div>
        )}
        {report && report.counts.deliveries > 0 && (
          <p className="choose-check">
            <CircleCheck size={18} aria-hidden="true" /> PayPal integration found: its webhook handler answered {report.counts.deliveries} deliveries.
          </p>
        )}
      </section>
      <section className="card" aria-label="The test">
        <h2>The test: a bad month</h2>
        <ul className="choose-list">
          {CUSTOMERS.map(({ icon: Icon, name, text }) => (
            <li key={name}>
              <Icon size={20} aria-hidden="true" />
              <div>
                <strong>{name}</strong>
                <span className="muted">{text}</span>
              </div>
            </li>
          ))}
        </ul>
        <button type="button" className="primary start" onClick={onStart} disabled={disabled || local?.running}>
          {local?.running ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {local?.running ? 'Playing the month...' : 'Start test'}
        </button>
        {local?.error && <p className="choose-error">{local.error}</p>}
      </section>
      <section className="card choose-wide" aria-label="What is real">
        <h2>What you are about to see</h2>
        <ul className="source-key">
          <li>
            <span className="chip info">
              <Landmark size={14} aria-hidden="true" /> Real sandbox
            </span>
            <span className="muted">Really happened on PayPal's sandbox, in a recorded run. No real money.</span>
          </li>
          <li>
            <span className="chip neutral">
              <FlaskConical size={14} aria-hidden="true" /> Simulated
            </span>
            <span className="muted">Played by our stand-in for PayPal, because the sandbox cannot move time.</span>
          </li>
          <li>
            <span className="chip neutral">
              <Bot size={14} aria-hidden="true" /> Claude
            </span>
            <span className="muted">Claude decides what customers do and explains failures. Plain checks decide pass or fail.</span>
          </li>
          <li>
            <span className="chip neutral">
              <CalendarClock size={14} aria-hidden="true" /> {local ? 'Run now' : 'Replay'}
            </span>
            <span className="muted">
              {local
                ? 'Start test plays the month now, on this machine, against the demo shop. Watch then plays that run at a pace you can follow.'
                : 'This public page replays a finished run, so it is the same for everyone and needs no keys. Run it on your machine to play it afresh.'}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
