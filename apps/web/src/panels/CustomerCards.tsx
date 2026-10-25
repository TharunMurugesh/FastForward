import type { CheckId } from '@fastforward/contracts';
import { Ban, CalendarX, CircleCheck, CirclePause, CircleX, Copy, Flag, ShieldX, Unplug, UserRound, type LucideIcon } from 'lucide-react';
import { CheckChip } from '../checkLook.js';
import { CHECK_TITLES } from '../format.js';
import type { NoticeRow } from '../grids/rows.js';
import type { MarkerKind, TimelineModel } from '../timeline/model.js';

const KIND: Record<MarkerKind, { icon: LucideIcon; label: string }> = {
  payment_ok: { icon: CircleCheck, label: 'paid' },
  payment_failed: { icon: CircleX, label: 'failed' },
  suspended: { icon: CirclePause, label: 'suspended' },
  cancelled: { icon: Ban, label: 'cancelled' },
  expired: { icon: CalendarX, label: 'expired' },
  dispute: { icon: Flag, label: 'dispute notices' },
  forged: { icon: ShieldX, label: 'forged' },
  duplicate: { icon: Copy, label: 'copies' },
  delivery_failed: { icon: Unplug, label: 'not delivered' },
};

/** One card per customer under the timeline: their month as counts, and which problems hit them. */
export function CustomerCards({ model, notices, onShowCustomer }: { model: TimelineModel; notices: NoticeRow[]; onShowCustomer: (eventId: string) => void }) {
  return (
    <div className="customer-cards">
      {model.rows.map((row, i) => {
        const markers = model.markers.filter((m) => m.row === i);
        const kinds = new Map<MarkerKind, number>();
        for (const m of markers) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
        const problems = new Map<CheckId, number>();
        for (const n of notices) if (n.customer === row.customer) for (const c of n.failedChecks) problems.set(c, (problems.get(c) ?? 0) + 1);
        const first = notices.find((n) => n.customer === row.customer && n.failedChecks.length > 0) ?? notices.find((n) => n.customer === row.customer);
        return (
          <article key={row.subscriptionId} className="card customer-card">
            <header>
              <span className="avatar" aria-hidden="true">
                <UserRound size={18} />
              </span>
              <div>
                <h3>{row.customer}</h3>
                <span className="muted mono small">{row.subscriptionId}</span>
              </div>
            </header>
            <ul className="kind-counts" aria-label="What happened">
              {[...kinds].map(([k, n]) => {
                const { icon: Icon, label } = KIND[k];
                return (
                  <li key={k} className={`k-${k}`}>
                    <Icon size={15} aria-hidden="true" />
                    <strong>{n}</strong> <span className="muted">{label}</span>
                  </li>
                );
              })}
            </ul>
            {problems.size > 0 ? (
              <div className="chips wrap" aria-label="Problems">
                {[...problems].map(([c, n]) => (
                  <CheckChip key={c} id={c} title={`${CHECK_TITLES[c]}: ${n} notices`} />
                ))}
              </div>
            ) : (
              <p className="cell-ok small">
                <CircleCheck size={14} aria-hidden="true" /> No problems
              </p>
            )}
            {first && (
              <button type="button" className="link" onClick={() => onShowCustomer(first.eventId)}>
                Open {row.customer}'s first {problems.size > 0 ? 'problem' : 'notice'}
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
