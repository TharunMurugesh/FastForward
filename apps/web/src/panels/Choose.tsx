import type { Report } from '@fastforward/contracts';
import { AppWindow, Bot, Bug, CalendarClock, CircleCheck, CreditCard, Flag, FlaskConical, Landmark, LoaderCircle, Play, Sparkles, Store, UserCheck, Waves } from 'lucide-react';

const CUSTOMERS = [
  { icon: UserCheck, name: 'Maya', text: 'Pays on time' },
  { icon: CreditCard, name: 'Leo', text: 'His card starts failing' },
  { icon: Flag, name: 'Ana', text: 'Says her coffee never came, and disputes' },
  { icon: Waves, name: 'Bad weather', text: 'Notices arrive twice, late, out of order, and one is forged' },
];

export interface OwnApp {
  webhookUrl: string;
  subscribeUrl: string;
  probeUrl: string;
}

export interface LocalChoice {
  target: 'demo' | 'own';
  setTarget: (t: 'demo' | 'own') => void;
  bugsOn: boolean;
  setBugsOn: (on: boolean) => void;
  own: OwnApp;
  setOwn: (app: OwnApp) => void;
  claudeAvailable: boolean;
  claudeLive: boolean;
  setClaudeLive: (live: boolean) => void;
  running: boolean;
  error: string | null;
}

const FIELDS: [keyof OwnApp, string][] = [
  ['webhookUrl', 'Webhook address'],
  ['subscribeUrl', 'Subscribe address'],
  ['probeUrl', 'Probe address (what the checks read your app\'s state from)'],
];

interface Props {
  report: Report | null;
  disabled: boolean;
  /** Set only when the demo runs on this machine: then the test is played afresh. */
  local: LocalChoice | null;
  onStart: () => void;
}

/** Step 1: which app, which test, and what the coming screens will and will not be real. */
export function Choose({ report, disabled, local, onStart }: Props) {
  return (
    <div className="choose">
      <section className="card" aria-label="Your app">
        <h2>Your app</h2>
        {local && (
          <div className="seg choose-target" role="group" aria-label="Which app to test">
            <button type="button" className={local.target === 'demo' ? 'on' : ''} aria-pressed={local.target === 'demo'} disabled={local.running} onClick={() => local.setTarget('demo')}>
              <Store size={15} aria-hidden="true" /> Demo shop
            </button>
            <button type="button" className={local.target === 'own' ? 'on' : ''} aria-pressed={local.target === 'own'} disabled={local.running} onClick={() => local.setTarget('own')}>
              <AppWindow size={15} aria-hidden="true" /> Your own app
            </button>
          </div>
        )}
        {local?.target === 'own' ? (
          <div className="own-app">
            {FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
                <input value={local.own[key]} onChange={(e) => local.setOwn({ ...local.own, [key]: e.target.value })} disabled={local.running} spellCheck={false} />
              </label>
            ))}
            <p className="muted small">
              Start your app on this machine with <code>FASTFORWARD=1 node --import fastforward-register your-server.js</code>, so its PayPal calls reach the stand-in.
            </p>
          </div>
        ) : (
          <div className="choose-app">
            <Store size={26} aria-hidden="true" />
            <div>
              <strong>Coffee Club</strong>
              <p className="muted">A demo subscription shop we built, with billing bugs planted on purpose. In real use, this is your own app.</p>
            </div>
          </div>
        )}
        {local && local.target === 'demo' && (
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
        {local?.claudeAvailable && (
          <div className="bug-switch">
            <span>
              <Sparkles size={18} aria-hidden="true" /> Claude's customers
            </span>
            <div className="seg" role="group" aria-label="Claude's customers">
              <button type="button" className={local.claudeLive ? '' : 'on'} aria-pressed={!local.claudeLive} disabled={local.running} onClick={() => local.setClaudeLive(false)}>
                Recorded
              </button>
              <button type="button" className={local.claudeLive ? 'on' : ''} aria-pressed={local.claudeLive} disabled={local.running} onClick={() => local.setClaudeLive(true)}>
                Live
              </button>
            </div>
          </div>
        )}
        {local?.claudeLive && <p className="muted small">Live: Claude decides each customer and writes the explanations now, using your Anthropic key. A run costs a few cents.</p>}
        {(!local || local.target === 'demo') && report && report.counts.deliveries > 0 && (
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
                ? `Start test plays the month now, on this machine, against ${local.target === 'own' ? 'your app' : 'the demo shop'}. Watch then plays that run at a pace you can follow.`
                : 'This public page replays a finished run, so it is the same for everyone and needs no keys. Run it on your machine to play it afresh.'}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
