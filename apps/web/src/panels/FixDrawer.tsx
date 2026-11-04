import type { CheckId, Report } from '@fastforward/contracts';
import { BookOpen, CircleCheckBig, ListFilter, Sparkles, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CheckBadge, Story } from '../checkLook.js';
import { CHECK_TITLES, explanationLabel, fmtDateTime } from '../format.js';

interface Props {
  check: CheckId | null;
  report: Report | null;
  onClose: () => void;
  /** Opens one notice in the deliveries tab. */
  onOpenNotice: (eventId: string) => void;
  onShowNotices: (check: CheckId) => void;
}

const EXAMPLES = 3;

/** PayPal's ids are about 50 characters; on screen the first part is enough, and the full text stays on hover. */
export const shortIds = (text: string) => text.replace(/\b((?:WH|I|PAYID|PP-D)-[A-Z0-9]{8})[A-Z0-9-]{6,}/g, '$1…');

/** The first sentence, so a long explanation opens short; the rest is one click away. */
export function firstSentence(text: string): string {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(text);
  return m ? m[0] : text;
}

/** A panel from the right with everything about one failed check: the fix first, then why, then examples. */
export function FixDrawer({ check, report, onClose, onOpenNotice, onShowNotices }: Props) {
  const close = useRef<HTMLButtonElement>(null);
  const [all, setAll] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => {
    setAll(false);
    setMore(false);
  }, [check]);
  const result = check ? report?.checks.find((c) => c.id === check) : undefined;

  useEffect(() => {
    if (!result) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, onClose]);

  if (!result) return null;
  const help = result.findings.find((f) => f.explanation || f.fix);
  const label = explanationLabel(help?.explanationSource);
  const withNotice = result.findings.filter((f) => f.eventIds[0]);

  return (
    <div className="drawer-layer">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`How to fix: ${CHECK_TITLES[result.id]}`}>
        <header className="drawer-head">
          <CheckBadge id={result.id} size="lg" />
          <div>
            <h2>{CHECK_TITLES[result.id]}</h2>
            <span className="muted mono small">{result.id}</span>
          </div>
          <button ref={close} type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="drawer-body">
          <Story id={result.id} />
          {help?.fix && (
            <section className="drawer-section fix">
              <h3>
                <Wrench size={16} aria-hidden="true" /> The fix
              </h3>
              <p>{help.fix}</p>
            </section>
          )}
          <section className="drawer-section">
            <h3>
              <CircleCheckBig size={16} aria-hidden="true" /> What a correct app does
            </h3>
            <Story id={result.id} remedy />
          </section>
          {help?.explanation && (
            <section className="drawer-section">
              <h3>
                <BookOpen size={16} aria-hidden="true" /> What happened in this run
              </h3>
              <p>
                {more ? help.explanation : firstSentence(help.explanation)}
                {!more && firstSentence(help.explanation) !== help.explanation && (
                  <>
                    {' '}
                    <button type="button" className="link" onClick={() => setMore(true)}>
                      Read more
                    </button>
                  </>
                )}
              </p>
            </section>
          )}
          {label && (
            <p className="ai-line small">
              <Sparkles size={14} aria-hidden="true" /> {label}
            </p>
          )}
          <section className="drawer-section">
            <h3>
              <ListFilter size={16} aria-hidden="true" /> {result.findings.length === 1 ? 'The finding' : `${result.findings.length} findings`}
            </h3>
            <ul className="examples">
              {result.findings.slice(0, all ? undefined : EXAMPLES).map((f, i) => (
                <li key={i}>
                  <span title={f.summary}>{shortIds(f.summary)}</span> <span className="muted small">{fmtDateTime(f.at)}</span>
                  {f.eventIds[0] && (
                    <>
                      {' '}
                      <button type="button" className="link" onClick={() => onOpenNotice(f.eventIds[0]!)}>
                        Open
                      </button>
                    </>
                  )}
                </li>
              ))}
              {!all && result.findings.length > EXAMPLES && (
                <li>
                  <button type="button" className="link" onClick={() => setAll(true)}>
                    Show {result.findings.length - EXAMPLES} more
                  </button>
                </li>
              )}
            </ul>
            {withNotice.length > 0 && (
              <button type="button" onClick={() => onShowNotices(result.id)}>
                <ListFilter size={15} aria-hidden="true" /> See them all in the table
              </button>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
