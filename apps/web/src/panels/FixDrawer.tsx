import type { CheckId, Report } from '@fastforward/contracts';
import { BookOpen, ListFilter, Sparkles, Wrench, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
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

const EXAMPLES = 5;

/** A panel from the right with everything about one failed check: the fix first, then why, then examples. */
export function FixDrawer({ check, report, onClose, onOpenNotice, onShowNotices }: Props) {
  const close = useRef<HTMLButtonElement>(null);
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
          {help?.explanation && (
            <section className="drawer-section">
              <h3>
                <BookOpen size={16} aria-hidden="true" /> What happened in this run
              </h3>
              <p>{help.explanation}</p>
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
              {result.findings.slice(0, EXAMPLES).map((f, i) => (
                <li key={i}>
                  <span>{f.summary}</span> <span className="muted small">{fmtDateTime(f.at)}</span>
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
              {result.findings.length > EXAMPLES && <li className="muted">and {result.findings.length - EXAMPLES} more</li>}
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
