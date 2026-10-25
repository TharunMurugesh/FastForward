import type { CheckId } from '@fastforward/contracts';
import {
  ArrowRight,
  Ban,
  Bell,
  CalendarClock,
  CircleCheckBig,
  Fingerprint,
  FlaskConical,
  Inbox,
  Lock,
  Send,
  ShieldCheck,
  CircleDollarSign,
  Coffee,
  Copy,
  Flag,
  Globe,
  Hourglass,
  KeyRound,
  Landmark,
  Mail,
  MessageSquareOff,
  PackageCheck,
  RefreshCw,
  ShieldAlert,
  ShieldOff,
  Timer,
  TriangleAlert,
  UserX,
  Code,
  type LucideIcon,
} from 'lucide-react';

/**
 * How each check looks everywhere on the dashboard: one icon and one colour, so the same problem is recognisable
 * on the overview, the timeline and the table. Colour never stands alone; the icon and the words carry it too.
 */
export interface CheckLook {
  icon: LucideIcon;
  /** CSS class that sets --tone for this check (see styles.css). */
  tone: string;
  /** Two or three words, for tiles and table chips. */
  short: string;
  /** What happened, as three pictures: what PayPal did, what the app did, what it cost. */
  story: [Step, Step, Step];
  /** The same moment handled by a correct app, as three pictures. */
  remedy: [Step, Step, Step];
}

interface Step {
  icon: LucideIcon;
  text: string;
}

export const CHECK_LOOK: Record<CheckId, CheckLook> = {
  ACK_FAST: {
    icon: Timer,
    tone: 'tone-ack',
    short: 'Slow answer',
    story: [
      { icon: Mail, text: 'PayPal sends a notice' },
      { icon: Hourglass, text: 'App answers after 10 s' },
      { icon: RefreshCw, text: 'PayPal gives up and retries' },
    ],
    remedy: [
      { icon: Mail, text: 'Notice arrives' },
      { icon: Inbox, text: 'Save it to a queue' },
      { icon: CircleCheckBig, text: 'Answer 200 at once, work later' },
    ],
  },
  VERIFIES_SIGNATURES: {
    icon: ShieldAlert,
    tone: 'tone-sig',
    short: 'Not verified',
    story: [
      { icon: Mail, text: 'A notice arrives' },
      { icon: ShieldOff, text: 'App never checks it came from PayPal' },
      { icon: UserX, text: 'Anyone can fake one' },
    ],
    remedy: [
      { icon: Mail, text: 'A notice arrives' },
      { icon: ShieldCheck, text: 'Ask PayPal to verify its signature' },
      { icon: Ban, text: 'Reject it unless the answer is SUCCESS' },
    ],
  },
  STATE_MATCHES: {
    icon: KeyRound,
    tone: 'tone-state',
    short: 'Wrong access',
    story: [
      { icon: Ban, text: 'PayPal suspends a subscription' },
      { icon: KeyRound, text: 'App keeps access open' },
      { icon: Coffee, text: 'Coffee without paying' },
    ],
    remedy: [
      { icon: Bell, text: 'A suspend or cancel notice arrives' },
      { icon: RefreshCw, text: 'Read the real status from PayPal' },
      { icon: Lock, text: 'Close access to match it' },
    ],
  },
  FULFIL_ONCE: {
    icon: Copy,
    tone: 'tone-once',
    short: 'Paid twice',
    story: [
      { icon: Copy, text: 'Same notice arrives twice' },
      { icon: PackageCheck, text: 'App ships both' },
      { icon: CircleDollarSign, text: 'Second order given away' },
    ],
    remedy: [
      { icon: Copy, text: 'The notice arrives again' },
      { icon: Fingerprint, text: 'Check its event id was seen before' },
      { icon: PackageCheck, text: 'Ship once, still answer 200' },
    ],
  },
  DISPUTE_ANSWERED: {
    icon: Flag,
    tone: 'tone-dispute',
    short: 'Dispute ignored',
    story: [
      { icon: Flag, text: 'Customer opens a dispute' },
      { icon: MessageSquareOff, text: 'App never replies' },
      { icon: Landmark, text: 'PayPal sides with the buyer' },
    ],
    remedy: [
      { icon: Flag, text: 'A dispute opens' },
      { icon: CalendarClock, text: 'Save the reply-by date' },
      { icon: Send, text: 'Send evidence through the disputes API' },
    ],
  },
  NO_LIVE_CALLS: {
    icon: Globe,
    tone: 'tone-live',
    short: 'Live call',
    story: [
      { icon: Code, text: 'Test code runs' },
      { icon: Globe, text: 'It calls real PayPal' },
      { icon: TriangleAlert, text: 'Real money at risk' },
    ],
    remedy: [
      { icon: Code, text: 'Test code runs' },
      { icon: FlaskConical, text: 'Point it at the sandbox' },
      { icon: ShieldCheck, text: 'No real money moves' },
    ],
  },
};

/** The check's icon on its colour: the one mark that means this check on every tab. */
export function CheckBadge({ id, size = 'md' }: { id: CheckId; size?: 'sm' | 'md' | 'lg' }) {
  const { icon: Icon, tone } = CHECK_LOOK[id];
  const px = { sm: 14, md: 18, lg: 22 }[size];
  return (
    <span className={`check-badge ${size} ${tone}`} aria-hidden="true">
      <Icon size={px} strokeWidth={2.2} />
    </span>
  );
}

/** A table-sized mark for one check; `dim` fades it while the table is focused on another check. */
export function CheckChip({ id, title, dim = false }: { id: CheckId; title: string; dim?: boolean }) {
  const { icon: Icon, tone, short } = CHECK_LOOK[id];
  return (
    <span className={`check-chip ${tone}${dim ? ' dim' : ''}`} title={title}>
      <Icon size={13} strokeWidth={2.4} aria-hidden="true" />
      {short}
    </span>
  );
}

/** The three-picture story of a failure, left to right; `remedy` tells the same moment done right. */
export function Story({ id, remedy = false }: { id: CheckId; remedy?: boolean }) {
  const { tone } = CHECK_LOOK[id];
  const story = remedy ? CHECK_LOOK[id].remedy : CHECK_LOOK[id].story;
  return (
    <ol className={`story ${remedy ? 'remedy' : tone}`} aria-label={remedy ? 'What a correct app does' : 'What happened'}>
      {story.map(({ icon: Icon, text }, i) => (
        <li key={i} className={i === story.length - 1 ? 'cost' : ''}>
          {i > 0 && <ArrowRight className="story-arrow" size={16} aria-hidden="true" />}
          <span className="story-icon" aria-hidden="true">
            <Icon size={20} strokeWidth={2} />
          </span>
          <span className="story-text">{text}</span>
        </li>
      ))}
    </ol>
  );
}
