import { BookOpen, CalendarClock, ChevronDown, ChevronRight, CircleCheck, CircleHelp, Clapperboard, Code, Coins, Copy, CreditCard, FileText, Flag, Home, Info, KeyRound, Menu, Monitor, Play, RefreshCw, Search, Wrench, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './concept.css';

const DASHBOARD_URL = 'http://localhost:8080/';

type Page = 'home' | 'clock';

const NAV_TOP: [string, LucideIcon][] = [['Docs', FileText], ['APIs & SDKs', Code], ['Tools', Wrench]];

const PLAYED: [string, string, LucideIcon][] = [
  ['Renewals', 'Months of billing cycles, in seconds', RefreshCw],
  ['Failed cards', 'Retries, then a suspended subscription', CreditCard],
  ['Disputes', 'A customer complains, and the clock runs', Flag],
  ['Duplicate notices', 'The same webhook, delivered twice', Copy],
];

function Played() {
  return (
    <ul className="played" aria-label="What a test plays">
      {PLAYED.map(([title, detail, Icon]) => (
        <li key={title}>
          <Icon size={26} aria-hidden="true" />
          <strong>{title}</strong>
          <span>{detail}</span>
        </li>
      ))}
    </ul>
  );
}

function Item({ icon: Icon, label, arrow }: { icon: LucideIcon; label: string; arrow?: boolean }) {
  return (
    <span className="nav-item">
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
      {arrow && <ChevronRight size={16} className="nav-arrow" aria-hidden="true" />}
    </span>
  );
}

function Sidebar({ page, open }: { page: Page; open: (page: Page) => void }) {
  return (
    <aside className="side">
      <div className="wordmark" aria-label="PayPal developer dashboard, concept">
        PayPal
      </div>
      <div className="env" aria-hidden="true">
        <span className="on">Sandbox</span>
        <span>Live</span>
      </div>
      <nav aria-label="Dashboard sections">
        <button type="button" className={page === 'home' ? 'active' : ''} onClick={() => open('home')}>
          <Item icon={Home} label="Home" />
        </button>
        <Item icon={KeyRound} label="Apps & Credentials" />
        <div className="group">
          <span className="nav-item">
            <Monitor size={16} aria-hidden="true" />
            <span>Testing Tools</span>
            <ChevronDown size={16} className="nav-arrow" aria-hidden="true" />
          </span>
          <span className="sub">Sandbox Accounts</span>
          <span className="sub">Sandbox Notifications</span>
          <span className="sub">Webhook Simulator</span>
          <button type="button" className={`sub${page === 'clock' ? ' active' : ''}`} onClick={() => open('clock')}>
            Test Clock
          </button>
        </div>
        <Item icon={BookOpen} label="Event Logs" arrow />
        <hr />
        {NAV_TOP.map(([label, icon]) => (
          <Item key={label} icon={icon} label={label} arrow />
        ))}
        <Item icon={Clapperboard} label="Video Library" />
        <Item icon={CircleHelp} label="Help" />
      </nav>
    </aside>
  );
}

function HomePage({ open }: { open: (page: Page) => void }) {
  return (
    <div className="content">
      <h1>Welcome back</h1>
      <p className="lead">Get started with step-by-step advice for setting up your payment solutions.</p>
      <section className="box">
        <span className="new">New in Testing Tools</span>
        <h2>Test a whole month of subscriptions in seconds</h2>
        <p>Renewals, failed cards, disputes and duplicate notices, played against your app before real customers meet them.</p>
        <button type="button" className="pill" onClick={() => open('clock')}>
          Open Test Clock
        </button>
      </section>
      <Played />
    </div>
  );
}

function Check({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <li>
      <Icon size={22} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <CircleCheck size={20} className="passed" aria-hidden="true" />
    </li>
  );
}

function ClockPage() {
  const [running, setRunning] = useState(false);
  if (running) {
    return (
      <div className="running">
        <div className="running-bar">
          <span>
            <CalendarClock size={18} aria-hidden="true" /> Test Clock
          </span>
          <span className="credits">
            <Coins size={16} aria-hidden="true" /> 2 free tests left
          </span>
        </div>
        <iframe title="Fastforward, running inside the concept" src={DASHBOARD_URL} />
      </div>
    );
  }
  return (
    <div className="content">
      <h1>Test Clock</h1>
      <p className="lead">Play months of renewals, failed cards and disputes against your app, in seconds, on the sandbox.</p>
      <div className="note">
        <Info size={18} aria-hidden="true" />
        <span>
          <strong>Before each test</strong> we check that your app is integrated with PayPal and that you have credits. One test costs $1, and your first 3 are free.
        </span>
      </div>
      <ul className="checks">
        <Check icon={KeyRound} title="PayPal integration found" detail="Coffee Club: a billing plan and a webhook are set up" />
        <Check icon={Coins} title="Credits available" detail="3 free tests left" />
      </ul>
      <button type="button" className="pill" onClick={() => setRunning(true)}>
        <Play size={15} aria-hidden="true" /> Start test
      </button>
      <Played />
    </div>
  );
}

function App() {
  const [page, setPage] = useState<Page>(() => (window.location.hash === '#clock' ? 'clock' : 'home'));
  useEffect(() => {
    const onHash = () => setPage(window.location.hash === '#clock' ? 'clock' : 'home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const open = (next: Page) => {
    window.location.hash = next;
  };
  return (
    <div className="shell">
      <Sidebar page={page} open={open} />
      <div className="main">
        <header className="top">
          <Menu size={20} aria-hidden="true" />
          <strong className="who">Vinay G</strong>
          <span className="search" aria-hidden="true">
            <Search size={16} /> Ask us anything
          </span>
          <span className="biz">Business Dashboard</span>
          <span className="avatar" aria-hidden="true">
            VG
          </span>
        </header>
        <div className="strip">You're in sandbox mode. Concept, not PayPal: a Fastforward mock-up, not a PayPal product.</div>
        {page === 'home' ? <HomePage open={open} /> : <ClockPage />}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
