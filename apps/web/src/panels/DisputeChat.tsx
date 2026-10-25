import type { TraceEntry } from '@fastforward/contracts';
import { Flag, Sparkles } from 'lucide-react';
import { CheckBadge } from '../checkLook.js';
import { fmtDateTime } from '../format.js';
import { disputeThreads } from './thread.js';

interface Props {
  trace: TraceEntry[];
  subscriptions: { customer: string; subscriptionId: string }[];
}

const WHO = { buyer: 'Customer', seller: 'Your app', system: 'PayPal' } as const;

export function DisputeChat({ trace, subscriptions }: Props) {
  const threads = disputeThreads(trace, subscriptions);
  if (threads.length === 0) {
    return (
      <div className="empty">
        <Flag size={28} className="muted" aria-hidden="true" />
        <p>
          <strong>No disputes yet</strong>
        </p>
        <p className="muted">When a simulated customer opens a dispute, the conversation appears here.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      {threads.map((t) => (
        <section key={t.disputeId} aria-label={`Dispute ${t.disputeId}`}>
          <h3>
            <CheckBadge id="DISPUTE_ANSWERED" size="sm" /> {t.customer}'s dispute <span className="mono muted small">{t.disputeId}</span>
          </h3>
          <ol className="chat">
            {t.messages.map((m, i) => (
              <li key={i} className={`bubble ${m.from}`}>
                <div className="who">
                  {WHO[m.from]} · <span className="muted">{fmtDateTime(m.at)}</span>
                  {m.byModel && (
                    <>
                      {' '}
                      <span className="ai-chip" title="The model decided what this customer says">
                        <Sparkles size={12} aria-hidden="true" /> Written by Claude
                      </span>
                    </>
                  )}
                </div>
                <div>{m.text}</div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
