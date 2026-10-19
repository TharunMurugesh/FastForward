import type { CSSProperties } from 'react';
import { fmtDate, fmtDateTime } from '../format.js';
import type { MarkerKind, TimelineMarker, TimelineModel } from './model.js';

interface Props {
  model: TimelineModel;
  range: { start: string; end: string };
  now: string;
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
}

const LABEL: Record<MarkerKind, string> = {
  payment_ok: 'Payment completed',
  payment_failed: 'Payment failed',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
  expired: 'Expired',
  dispute: 'Dispute',
  forged: 'Forged notice',
  duplicate: 'Duplicate delivery',
  delivery_failed: 'Delivery failed',
};

/** Shape as well as colour, so the meaning survives colour blindness. Paths are drawn in a 12x12 box. */
const GLYPH: Record<MarkerKind, string> = {
  payment_ok: 'M6 1.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6z',
  payment_failed: 'M6 1 11.2 10.6H.8z',
  suspended: 'M2 2h8v8H2z',
  cancelled: 'M2 2 10 10M10 2 2 10',
  expired: 'M2 2 10 10M10 2 2 10',
  dispute: 'M6 .8 11.2 6 6 11.2.8 6z',
  forged: 'M2.5 1v10M2.5 1.5h7l-2 2.6 2 2.6h-7',
  duplicate: 'M1.5 3.5h6v6h-6zM4.5 1h6v6',
  delivery_failed: 'M6 1.6a4.4 4.4 0 1 1 0 8.8 4.4 4.4 0 0 1 0-8.8zM3 9 9 3',
};
const STROKE_ONLY = new Set<MarkerKind>(['cancelled', 'expired', 'forged', 'duplicate', 'delivery_failed']);
/** Markers about the delivery, not the event, sit on a second lane under the row's line. */
const LOWER_LANE = new Set<MarkerKind>(['duplicate', 'delivery_failed']);

export function Timeline({ model, range, now, selectedEventId, onSelect }: Props) {
  const t0 = Date.parse(range.start);
  const span = Math.max(Date.parse(range.end) - t0, 1);
  const pct = (iso: string) => Math.min(Math.max(((Date.parse(iso) - t0) / span) * 100, 0), 100);

  // Month ticks along the top.
  const ticks: { label: string; left: number }[] = [];
  const cursor = new Date(range.start);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  if (cursor.getTime() < t0) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= t0 + span) {
    ticks.push({ label: fmtDate(cursor.toISOString()), left: pct(cursor.toISOString()) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  // Nudge markers that would sit on top of each other (same lane, nearly the same time).
  const slots = new Map<string, number>();
  const placed = model.markers.map((m: TimelineMarker, index) => {
    const lane = LOWER_LANE.has(m.kind) ? 1 : 0;
    const key = `${m.row}:${lane}:${Math.round(pct(m.at) * 3)}`;
    const n = slots.get(key) ?? 0;
    slots.set(key, n + 1);
    return { m, index, lane, left: pct(m.at), nudge: n * 15 };
  });

  const present = [...new Set(model.markers.map((m) => m.kind))];

  return (
    <section className="card timeline" aria-label="Timeline of events per customer">
      <div className="timeline-grid">
        <div className="tl-axis">
          <span className="tl-label" />
          <div className="tl-track tl-ticks" aria-hidden="true">
            {ticks.map((t) => (
              <span key={t.label} className="tl-tick" style={{ left: `${t.left}%` }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
        {model.rows.map((row, i) => (
          <div className="tl-row" key={row.subscriptionId}>
            <span className="tl-label" title={row.subscriptionId}>
              {row.customer}
            </span>
            <div className="tl-track">
              <div className="tl-line" />
              {placed
                .filter((p) => p.m.row === i)
                .map(({ m, index, lane, left, nudge }) => (
                  <button
                    key={`${m.eventId}-${m.kind}-${m.at}-${index}`}
                    type="button"
                    className={`tl-marker k-${m.kind}${selectedEventId === m.eventId ? ' selected' : ''}`}
                    style={{ left: `calc(${left}% + ${nudge}px)`, top: lane === 0 ? '4px' : '24px' } as CSSProperties}
                    onClick={() => onSelect(m.eventId)}
                    title={`${LABEL[m.kind]}${m.count && m.count > 1 ? ` ×${m.count}` : ''} · ${fmtDateTime(m.at)}`}
                    aria-label={`${row.customer}: ${LABEL[m.kind]}${m.count && m.count > 1 ? `, ${m.count} attempts` : ''}, ${fmtDateTime(m.at)}`}
                  >
                    <svg viewBox="0 0 12 12" width="14" height="14" aria-hidden="true">
                      <path d={GLYPH[m.kind]} fill={STROKE_ONLY.has(m.kind) ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                    </svg>
                  </button>
                ))}
            </div>
          </div>
        ))}
        <div className="tl-now-layer" aria-hidden="true">
          <span className="tl-label" />
          <div className="tl-track">
            <div className={`tl-now${pct(now) > 88 ? ' late' : ''}`} style={{ left: `${pct(now)}%` }}>
              <span>{fmtDate(now)}</span>
            </div>
          </div>
        </div>
      </div>
      <ul className="legend" aria-label="Legend">
        {present.map((k) => (
          <li key={k} className={`k-${k}`}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <path d={GLYPH[k]} fill={STROKE_ONLY.has(k) ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            {LABEL[k]}
          </li>
        ))}
      </ul>
    </section>
  );
}
