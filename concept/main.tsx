import { Activity, AppWindow, BookOpen, CalendarClock, ChevronDown, ChevronRight, ChevronUp, CircleCheck, CircleHelp, Clapperboard, Code, Coins, Copy, CreditCard, ExternalLink, FileText, Flag, Home, Inbox, Info, KeyRound, LayoutGrid, Menu, MessageSquare, Monitor, MoreVertical, Play, RefreshCw, Repeat, Search, Send, ShoppingCart, Users, Wrench, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import report from '../fidelity/real-report.json';
import './concept.css';

const DASHBOARD_URL = 'http://localhost:8080/';
const FREE_TESTS = 3;

interface Route {
  id: string;
  title: string;
  blurb?: string;
}

const LEAF_TOP: (Route & { icon: LucideIcon })[] = [
  { id: 'home', title: 'Home', icon: Home },
  { id: 'apps', title: 'Apps & Credentials', icon: KeyRound },
];
const LEAF_BOTTOM: (Route & { icon: LucideIcon })[] = [
  { id: 'videos', title: 'Video Library', icon: Clapperboard, blurb: 'Short videos on setting up payments and testing them.' },
  { id: 'help', title: 'Help', icon: CircleHelp, blurb: 'Answers to common questions, and how to reach support.' },
];
const GROUPS: { id: string; title: string; icon: LucideIcon; divider?: true; items: Route[] }[] = [
  {
    id: 'testing',
    title: 'Testing Tools',
    icon: Monitor,
    items: [
      { id: 'accounts', title: 'Sandbox Accounts' },
      { id: 'notifications', title: 'Sandbox Notifications' },
      { id: 'simulator', title: 'Webhook Simulator' },
      { id: 'clock', title: 'Test Clock' },
    ],
  },
  {
    id: 'logs',
    title: 'Event Logs',
    icon: BookOpen,
    items: [
      { id: 'api-calls', title: 'API Calls' },
      { id: 'webhook-events', title: 'Webhook Events' },
      { id: 'error-logs', title: 'Error Logs' },
    ],
  },
  {
    id: 'docs',
    title: 'Docs',
    icon: FileText,
    divider: true,
    items: [
      { id: 'docs-start', title: 'Get Started', blurb: 'Create an app, get sandbox credentials and make your first API call.' },
      { id: 'docs-subs', title: 'Subscriptions', blurb: 'Bill customers at regular intervals with plans and subscriptions.' },
      { id: 'docs-hooks', title: 'Webhooks', blurb: 'Get notified when something happens to a payment or a subscription.' },
    ],
  },
  {
    id: 'apis',
    title: 'APIs & SDKs',
    icon: Code,
    items: [
      { id: 'api-rest', title: 'REST APIs', blurb: 'The reference for orders, subscriptions, disputes and webhooks.' },
      { id: 'api-js', title: 'JavaScript SDK', blurb: 'Add payment buttons and card fields to your checkout page.' },
      { id: 'api-server', title: 'Server SDKs', blurb: 'Call PayPal from your server in Node, Python, Java and more.' },
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    icon: Wrench,
    items: [
      { id: 'cards', title: 'Test Credit Cards', blurb: 'Generate test card numbers to use on the sandbox.' },
      { id: 'negative', title: 'Negative Testing', blurb: 'Trigger API errors on purpose to see how your app responds.' },
    ],
  },
];
const ROUTES: Route[] = [...LEAF_TOP, ...GROUPS.flatMap((g) => g.items), ...LEAF_BOTTOM];
const findRoute = (id: string) => ROUTES.find((r) => r.id === id);
const groupOf = (id: string) => GROUPS.find((g) => g.items.some((i) => i.id === id))?.id;

const routeFromHash = () => {
  const id = window.location.hash.replace(/^#/, '');
  return findRoute(id) ? id : 'home';
};

type Go = (id: string) => void;
type Say = (message: string) => void;

const NOT_HERE = "Not part of this concept. It's a mock-up, so nothing happens at PayPal.";

function Sidebar({ route, go, say, open }: { route: string; go: Go; say: Say; open: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(() => groupOf(route) ?? null);
  useEffect(() => {
    const g = groupOf(route);
    if (g) setExpanded(g);
  }, [route]);
  const leaf = ({ id, title, icon: Icon }: Route & { icon: LucideIcon }) => (
    <button key={id} type="button" className={`nav-item${route === id ? ' active' : ''}`} aria-current={route === id ? 'page' : undefined} onClick={() => go(id)}>
      <Icon size={16} aria-hidden="true" />
      <span>{title}</span>
    </button>
  );
  return (
    <aside className={`side${open ? '' : ' closed'}`}>
      <button type="button" className="wordmark" aria-label="Home of the concept, not PayPal" onClick={() => go('home')}>
        PayPal
      </button>
      <div className="env" role="group" aria-label="Environment">
        <button type="button" className="on">
          Sandbox
        </button>
        <button type="button" onClick={() => say('This concept only runs on the sandbox. Fastforward never touches live PayPal.')}>
          Live
        </button>
      </div>
      <nav aria-label="Dashboard sections">
        {LEAF_TOP.map(leaf)}
        {GROUPS.map(({ id, title, icon: Icon, divider, items }) => {
          const isOpen = expanded === id;
          return (
            <div key={id} className="group-wrap">
              {divider && <hr />}
              <div className={isOpen ? 'group open' : 'group'}>
                <button type="button" className="nav-item" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? null : id)}>
                  <Icon size={16} aria-hidden="true" />
                  <span>{title}</span>
                  {isOpen ? <ChevronDown size={16} className="nav-arrow" aria-hidden="true" /> : <ChevronRight size={16} className="nav-arrow" aria-hidden="true" />}
                </button>
                {isOpen &&
                  items.map((item) => (
                    <button key={item.id} type="button" className={`sub${route === item.id ? ' active' : ''}${item.id === 'clock' ? ' ours' : ''}`} aria-current={route === item.id ? 'page' : undefined} onClick={() => go(item.id)}>
                      {item.title}
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
        {LEAF_BOTTOM.map(leaf)}
      </nav>
    </aside>
  );
}

function SearchBox({ go }: { go: Go }) {
  const [text, setText] = useState('');
  const hits = useMemo(() => {
    const q = text.trim().toLowerCase();
    return q ? ROUTES.filter((r) => r.title.toLowerCase().includes(q) || r.blurb?.toLowerCase().includes(q)).slice(0, 6) : [];
  }, [text]);
  const pick = (id: string) => {
    setText('');
    go(id);
  };
  return (
    <div className="search">
      <Search size={16} aria-hidden="true" />
      <input
        value={text}
        placeholder="Ask us anything"
        aria-label="Search this concept"
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && hits[0]) pick(hits[0].id);
          if (e.key === 'Escape') setText('');
        }}
      />
      {text.trim() && (
        <ul className="search-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" onClick={() => pick(h.id)}>
                {h.title}
              </button>
            </li>
          ))}
          {hits.length === 0 && <li className="none">No matches in this concept</li>}
        </ul>
      )}
    </div>
  );
}

function AvatarMenu() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="avatar-wrap" ref={box}>
      <button type="button" className="avatar" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        VG
      </button>
      {open && (
        <div className="menu" role="menu">
          <strong>Vinay G</strong>
          <span>This is a mock-up, so there is no account and no sign-in.</span>
        </div>
      )}
    </div>
  );
}

function Banner({ go }: { go: Go }) {
  const [shown, setShown] = useState(true);
  if (!shown) return null;
  return (
    <div className="banner">
      <Info size={16} aria-hidden="true" />
      <span>
        Fastforward Test Clock is now in Testing Tools.{' '}
        <button type="button" className="strong" onClick={() => go('clock')}>
          Get Started
        </button>
      </span>
      <button type="button" className="close" aria-label="Dismiss" onClick={() => setShown(false)}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

const SOLUTIONS: Record<string, { title: string; text: string; colour: string; icon: LucideIcon }[]> = {
  'Most popular': [
    { title: 'PayPal Checkout', text: 'Set up standard payments on your checkout page for your buyers.', colour: '#ffc439', icon: ShoppingCart },
    { title: 'Expanded Checkout', text: 'Build and customize a card payment form to accept debit and credit cards.', colour: '#0070e0', icon: CreditCard },
    { title: 'Subscriptions', text: 'Create subscriptions to bill customers at regular intervals.', colour: '#6cc000', icon: Repeat },
  ],
  Online: [
    { title: 'PayPal Checkout', text: 'Set up standard payments on your checkout page for your buyers.', colour: '#ffc439', icon: ShoppingCart },
    { title: 'Subscriptions', text: 'Create subscriptions to bill customers at regular intervals.', colour: '#6cc000', icon: Repeat },
  ],
  Payouts: [{ title: 'Payouts', text: 'Send money to many recipients at once.', colour: '#0070e0', icon: Send }],
  'Multi-party': [{ title: 'Multiparty', text: 'Take payments on behalf of the sellers on your platform.', colour: '#6cc000', icon: Users }],
};

const SHORTCUTS: [string, string, LucideIcon][] = [
  ['API & credentials', 'apps', KeyRound],
  ['Sandbox accounts', 'accounts', Users],
  ['API calls', 'api-calls', Activity],
  ['Webhooks events', 'webhook-events', MessageSquare],
  ['Webhooks simulator', 'simulator', Send],
  ['Test Clock', 'clock', CalendarClock],
  ['Test credit cards', 'cards', CreditCard],
  ['Dev docs', 'docs-start', FileText],
];

const STAMP = 'From a recorded Fastforward run on the real sandbox';

function HomePage({ go }: { go: Go }) {
  const [app, setApp] = useState('Coffee Club');
  const [span, setSpan] = useState('Last 12 hours');
  const [tab, setTab] = useState('Most popular');
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  return (
    <>
      <div className="title-row">
        <div>
          <h1>Welcome back</h1>
          <p className="lead">Get started with step-by-step advice for setting up your payment solutions.</p>
        </div>
        <div className="selects">
          <select aria-label="Application" value={app} onChange={(e) => setApp(e.target.value)}>
            <option>Coffee Club</option>
            <option>Default Application</option>
          </select>
          <select aria-label="Period" value={span} onChange={(e) => setSpan(e.target.value)}>
            <option>Last 12 hours</option>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
          </select>
        </div>
      </div>
      {!hidden && (
        <section className="box">
          <header className="box-head">
            <h2>Which Payment Solution do you want to offer?</h2>
            <button type="button" aria-label={collapsed ? 'Show' : 'Hide'} onClick={() => setCollapsed(!collapsed)}>
              {collapsed ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
            </button>
            <button type="button" aria-label="Close" onClick={() => setHidden(true)}>
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          {!collapsed && (
            <>
              <p className="small">
                We'll help you set up everything from integration to go-live. Already started?{' '}
                <button type="button" className="link" onClick={() => setHidden(true)}>
                  Skip this step.
                </button>
              </p>
              <div className="tabs" role="tablist">
                {Object.keys(SOLUTIONS).map((t) => (
                  <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </div>
              <ul className="solutions">
                {SOLUTIONS[tab]!.map(({ title, text, colour, icon: Icon }) => (
                  <li key={title}>
                    <button type="button" onClick={() => go(title === 'Subscriptions' ? 'docs-subs' : 'docs-start')}>
                      <span className="art" style={{ background: colour }}>
                        <Icon size={46} aria-hidden="true" />
                      </span>
                      <strong>{title}</strong>
                      <span className="small">{text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      <ul className="shortcuts">
        {SHORTCUTS.map(([label, id, Icon]) => (
          <li key={id}>
            <button type="button" onClick={() => go(id)}>
              <span className={id === 'clock' ? 'round ours' : 'round'}>
                <Icon size={22} aria-hidden="true" />
              </span>
              {label}
            </button>
          </li>
        ))}
      </ul>
      <div className="title-row section">
        <h2>Error log</h2>
        <button type="button" className="pill soft" onClick={() => go('error-logs')}>
          View all errors
        </button>
      </div>
      <div className="no-errors">
        <CircleCheck size={24} aria-hidden="true" />
        <strong>No errors found</strong>
        <span>We found 0 errors in this period.</span>
      </div>
      <h2 className="section">Monitoring</h2>
      <ul className="tiles">
        <li>
          <strong>API calls</strong>
          <dl>
            <div>
              <dt>Successful requests</dt>
              <dd>{report.actions.length}</dd>
            </div>
            <div>
              <dt>Errors</dt>
              <dd>0</dd>
            </div>
          </dl>
        </li>
        <li>
          <strong>Webhook events</strong>
          <dl>
            <div>
              <dt>Delivered</dt>
              <dd>{report.notices.length}</dd>
            </div>
            <div>
              <dt>Signature SUCCESS</dt>
              <dd>{report.notices.filter((n) => n.verify === 'SUCCESS').length}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </>
  );
}

function AppsPage({ say }: { say: Say }) {
  return (
    <>
      <div className="title-row">
        <h1>API Credentials</h1>
        <button type="button" className="pill" onClick={() => say(NOT_HERE)}>
          Create App
        </button>
      </div>
      <div className="note warm">
        <Info size={18} aria-hidden="true" />
        <span>This concept never asks for, shows or stores credentials. Your keys stay in your own <code>.env</code> file.</span>
      </div>
      <h2 className="section">REST API apps</h2>
      <Table
        head={['App name', 'Client ID', 'Secret', 'Status']}
        rows={[
          ['Coffee Club', 'Not shown', 'Not shown', 'Integrated'],
          ['Default Application', 'Not shown', 'Not shown', 'Not integrated'],
        ]}
      />
    </>
  );
}

function AccountsPage({ say }: { say: Say }) {
  const rows = [
    { name: 'buyer@personal.example.com', apps: 0, type: 'Personal', country: 'US', tag: '' },
    { name: 'coffee-club@business.example.com', apps: 1, type: 'Business', country: 'US', tag: '' },
    { name: 'default@business.example.com', apps: 1, type: 'Business', country: 'IN', tag: 'Default' },
    { name: 'default@personal.example.com', apps: 0, type: 'Personal', country: 'IN', tag: 'Default' },
  ];
  return (
    <>
      <div className="title-row">
        <h1>Sandbox test accounts</h1>
        <div className="selects">
          <button type="button" className="pill soft" onClick={() => say(NOT_HERE)}>
            Create bulk accounts
          </button>
          <button type="button" className="pill" onClick={() => say(NOT_HERE)}>
            Create account
          </button>
        </div>
      </div>
      <p className="lead">You can use sandbox accounts to test your apps and mimic live transactions.</p>
      <h3>Showing {rows.length} example accounts:</h3>
      <Table
        head={['Account name', 'Apps', 'Type', 'Country', 'Settings']}
        rows={rows.map((r) => [
          <span key="n" className="account">
            {r.name} {r.tag && <span className="tag">{r.tag}</span>}
          </span>,
          String(r.apps),
          r.type,
          r.country,
          <button key="s" type="button" aria-label={`Settings for ${r.name}`} onClick={() => say(NOT_HERE)}>
            <MoreVertical size={18} aria-hidden="true" />
          </button>,
        ])}
      />
    </>
  );
}

function NotificationsPage() {
  const items = [
    ['Test Clock finished', 'Coffee Club: 3 of 6 checks failed over 75 simulated days.'],
    ['Subscription reactivated', 'Sam updated the card on the real sandbox.'],
    ['Webhook delivered twice', "PayPal's own resend sent a payment notice again."],
  ];
  return (
    <>
      <h1>Sandbox Notifications</h1>
      <p className="lead">Example messages from your test runs.</p>
      <ul className="list">
        {items.map(([title, text]) => (
          <li key={title}>
            <Inbox size={20} aria-hidden="true" />
            <div>
              <strong>{title}</strong>
              <span>{text}</span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function SimulatorPage({ go }: { go: Go }) {
  const [url, setUrl] = useState('https://');
  const [type, setType] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <>
      <h1>Webhooks simulator</h1>
      <p className="small">After you configure a listener, you can use the Webhooks simulator with a sample payload to simulate mock webhook events.</p>
      <div className="note warm">
        <Info size={18} aria-hidden="true" />
        <span>
          <strong>Note:</strong> Because these are mock events, you cannot verify, resend an event notification for, or show webhook details for simulator-generated events.
        </span>
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          setSent(true);
        }}
      >
        <label>
          Webhooks URL
          <input value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Event Type
          <select value={type} onChange={(e) => setType(e.target.value)} required>
            <option value="" disabled>
              Choose one
            </option>
            <option>BILLING.SUBSCRIPTION.ACTIVATED</option>
            <option>BILLING.SUBSCRIPTION.SUSPENDED</option>
            <option>PAYMENT.SALE.COMPLETED</option>
          </select>
        </label>
        <button type="submit" className="pill">
          Send Test
        </button>
      </form>
      {sent && (
        <div className="note cool">
          <CalendarClock size={18} aria-hidden="true" />
          <span>
            One mock event, no real signature, and no next month. In this concept nothing was sent.{' '}
            <button type="button" className="link" onClick={() => go('clock')}>
              Test a whole month with Test Clock
            </button>
          </span>
        </div>
      )}
    </>
  );
}

const ACTION_CALLS: Record<string, string> = {
  'create product': 'POST /v1/catalogs/products',
  'create plan': 'POST /v1/billing/plans',
  'create subscription': 'POST /v1/billing/subscriptions',
  suspend: 'POST /v1/billing/subscriptions/{id}/suspend',
  activate: 'POST /v1/billing/subscriptions/{id}/activate',
  'cancel (end of run)': 'POST /v1/billing/subscriptions/{id}/cancel',
  'resend a notice': 'POST /v1/notifications/webhooks-events/{id}/resend',
};

function ApiCallsPage() {
  return (
    <>
      <h1>API Calls</h1>
      <p className="lead">{STAMP}.</p>
      <Table head={['Call', 'Status', 'Step']} rows={report.actions.map((a) => [<code key="c">{ACTION_CALLS[a.name] ?? a.name}</code>, String(a.status), a.name])} />
    </>
  );
}

function WebhookEventsPage() {
  const [resource, setResource] = useState('');
  const [type, setType] = useState('All event types');
  const [filter, setFilter] = useState({ resource: '', type: 'All event types' });
  const types = [...new Set(report.notices.map((n) => n.eventType))];
  const rows = report.notices.filter((n) => (filter.type === 'All event types' || n.eventType === filter.type) && (!filter.resource || n.resourceId.toLowerCase().includes(filter.resource.toLowerCase())));
  return (
    <>
      <h1>Webhook Events</h1>
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter({ resource: resource.trim(), type });
        }}
      >
        <label>
          Application
          <select>
            <option>Coffee Club</option>
          </select>
        </label>
        <label>
          Resource ID
          <input value={resource} onChange={(e) => setResource(e.target.value)} autoComplete="off" />
        </label>
        <label>
          Event type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option>All event types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="pill blue">
          Search
        </button>
      </form>
      {rows.length > 0 ? (
        <Table
          head={['Event type', 'Event ID', 'Resource ID', 'Status']}
          rows={rows.map((n) => [
            <span key="t">
              {n.eventType} {n.duplicate && <span className="tag">Sent again</span>}
            </span>,
            <code key="i">{n.eventId}</code>,
            n.resourceId,
            `Signature ${n.verify}`,
          ])}
        />
      ) : (
        <div className="no-errors">
          <strong>No data for this selection.</strong>
        </div>
      )}
      <div className="note warm">
        <Info size={18} aria-hidden="true" />
        <span>{STAMP}.</span>
      </div>
    </>
  );
}

function ErrorLogsPage() {
  return (
    <>
      <h1>Error Logs</h1>
      <div className="no-errors">
        <CircleCheck size={24} aria-hidden="true" />
        <strong>No errors found</strong>
        <span>{STAMP} had no API errors.</span>
      </div>
    </>
  );
}

function InfoPage({ route, go }: { route: Route; go: Go }) {
  return (
    <>
      <h1>{route.title}</h1>
      <p className="lead">{route.blurb}</p>
      <section className="box">
        <span className="new">Concept</span>
        <h2>This page stands in for PayPal's own {route.title} page</h2>
        <p>The mock-up only builds what the Test Clock needs. To see what we built, open the tool itself.</p>
        <button type="button" className="pill" onClick={() => go('clock')}>
          <ExternalLink size={15} aria-hidden="true" /> Open Test Clock
        </button>
      </section>
    </>
  );
}

const PLAYED: [string, string, LucideIcon][] = [
  ['Renewals', 'Months of billing cycles, in seconds', RefreshCw],
  ['Failed cards', 'Retries, then a suspended subscription', CreditCard],
  ['Disputes', 'A customer complains, and the clock runs', Flag],
  ['Duplicate notices', 'The same webhook, delivered twice', Copy],
];

function ClockPage({ credits, running, start, stop, say }: { credits: number; running: boolean; start: () => void; stop: () => void; say: Say }) {
  const left = `${credits} free ${credits === 1 ? 'test' : 'tests'} left`;
  if (running) {
    return (
      <div className="running">
        <div className="running-bar">
          <span>
            <CalendarClock size={18} aria-hidden="true" /> Test Clock
          </span>
          <span className="credits">
            <Coins size={16} aria-hidden="true" /> {left}
            <button type="button" className="pill soft" onClick={stop}>
              End test
            </button>
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
      <div className="note warm">
        <Info size={18} aria-hidden="true" />
        <span>
          <strong>Before each test</strong> we check that your app is integrated with PayPal and that you have credits. One test costs $1, and your first {FREE_TESTS} are free.
        </span>
      </div>
      <ul className="checks">
        <li>
          <KeyRound size={22} aria-hidden="true" />
          <div>
            <strong>PayPal integration found</strong>
            <span>Coffee Club: a billing plan and a webhook are set up</span>
          </div>
          <CircleCheck size={20} className="passed" aria-hidden="true" />
        </li>
        <li>
          <Coins size={22} aria-hidden="true" />
          <div>
            <strong>{credits > 0 ? 'Credits available' : 'No credits left'}</strong>
            <span>{credits > 0 ? left : '$10 buys 10 tests'}</span>
          </div>
          {credits > 0 && <CircleCheck size={20} className="passed" aria-hidden="true" />}
        </li>
      </ul>
      {credits > 0 ? (
        <button type="button" className="pill" onClick={start}>
          <Play size={15} aria-hidden="true" /> Start test
        </button>
      ) : (
        <button type="button" className="pill" onClick={() => say('Buying credits is planned, not built. This mock-up takes no payments.')}>
          <Coins size={15} aria-hidden="true" /> Buy credits
        </button>
      )}
      <ul className="played" aria-label="What a test plays">
        {PLAYED.map(([title, detail, Icon]) => (
          <li key={title}>
            <Icon size={26} aria-hidden="true" />
            <strong>{title}</strong>
            <span>{detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [navOpen, setNavOpen] = useState(() => window.innerWidth > 900);
  const [toast, setToast] = useState<string | null>(null);
  const [credits, setCredits] = useState(FREE_TESTS);
  const [running, setRunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    document.title = `${findRoute(route)!.title}: concept, not PayPal`;
    document.querySelector('.scroll')?.scrollTo({ top: 0 });
  }, [route]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go: Go = (id) => {
    window.location.hash = id;
    if (window.innerWidth <= 900) setNavOpen(false);
  };
  const say: Say = (message) => {
    setToast(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  };
  const current = findRoute(route)!;
  const pages: Record<string, ReactNode> = {
    home: <HomePage go={go} />,
    apps: <AppsPage say={say} />,
    accounts: <AccountsPage say={say} />,
    notifications: <NotificationsPage />,
    simulator: <SimulatorPage go={go} />,
    'api-calls': <ApiCallsPage />,
    'webhook-events': <WebhookEventsPage />,
    'error-logs': <ErrorLogsPage />,
  };
  return (
    <div className="shell">
      <Sidebar route={route} go={go} say={say} open={navOpen} />
      <div className="main">
        <header className="top">
          <button type="button" aria-label={navOpen ? 'Hide the menu' : 'Show the menu'} aria-expanded={navOpen} onClick={() => setNavOpen(!navOpen)}>
            <Menu size={20} aria-hidden="true" />
          </button>
          <strong className="who">Vinay G</strong>
          <SearchBox go={go} />
          <button type="button" className="biz" onClick={() => say(NOT_HERE)}>
            <LayoutGrid size={14} aria-hidden="true" /> Business Dashboard
          </button>
          <AvatarMenu />
        </header>
        <div className="strip">You're in sandbox mode. Concept, not PayPal: a Fastforward mock-up, not a PayPal product.</div>
        <Banner go={go} />
        {route === 'clock' ? (
          <ClockPage
            credits={credits}
            running={running}
            say={say}
            start={() => {
              setCredits(credits - 1);
              setRunning(true);
            }}
            stop={() => setRunning(false)}
          />
        ) : (
          <div className="scroll">
            <div className="content">
              {pages[route] ?? <InfoPage route={current} go={go} />}
              <footer className="foot">
                <AppWindow size={14} aria-hidden="true" /> Concept, not PayPal. Not affiliated with or endorsed by PayPal.
              </footer>
            </div>
          </div>
        )}
      </div>
      {toast && (
        <div className="toast" role="status">
          <Info size={16} aria-hidden="true" /> {toast}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
