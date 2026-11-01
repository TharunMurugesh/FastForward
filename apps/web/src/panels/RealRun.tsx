import { CircleCheck, Copy, FlaskConical, Landmark, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { realSteps, type RealRunFile } from '../realRun.js';

function signature(notice: RealRunFile['notices'][number], certFetched: boolean): string {
  if (notice.verify !== 'not-asked') return `PayPal said ${notice.verify}`;
  return certFetched ? 'Checked offline, or not at all' : 'Not checked';
}

/** The recorded real run: what the real PayPal sandbox did, told apart from what it cannot do. */
export function RealRun({ report, onOpenTimeline }: { report: RealRunFile | null; onOpenTimeline: () => void }) {
  if (!report) {
    return (
      <section className="card empty-state">
        <Landmark size={32} aria-hidden="true" />
        <h2>No real run recorded yet</h2>
        <p className="muted">
          Record one with <code>fastforward real &lt;scenario.yaml&gt; --public-url &lt;https://...&gt; --report-dir fidelity</code>
        </p>
      </section>
    );
  }
  const { notices } = report;
  const verified = notices.filter((n) => n.verify === 'SUCCESS').length;
  const answered = notices.filter((n) => n.appStatus !== null && n.appStatus >= 200 && n.appStatus < 300).length;
  return (
    <div className="stack">
      <section className="card" aria-label="Real PayPal run">
        <header className="card-head">
          <div>
            <h2>Against the real PayPal sandbox</h2>
            <p className="muted">
              A recording of one real run, subscription <code>{report.subscriptionId ?? 'not created'}</code>. Sandbox only: no real money moved.
            </p>
          </div>
        </header>
        {report.error && (
          <p className="match-note">
            <TriangleAlert size={18} aria-hidden="true" />
            <span>
              <strong>This run stopped early.</strong> {report.error}
            </span>
          </p>
        )}
        <ul className="stat-tiles">
          <li className="neutral">
            <Radio size={20} aria-hidden="true" />
            <strong>{notices.length}</strong>
            <span>real notices passed to the app</span>
          </li>
          <li className={answered === notices.length ? 'ok' : 'bad'}>
            <CircleCheck size={20} aria-hidden="true" />
            <strong>
              {answered}/{notices.length}
            </strong>
            <span>answered with a success</span>
          </li>
          <li className={verified === notices.length ? 'ok' : 'neutral'}>
            <ShieldCheck size={20} aria-hidden="true" />
            <strong>
              {verified}/{notices.length}
            </strong>
            <span>signatures PayPal called SUCCESS</span>
          </li>
        </ul>
        <ol className="real-steps">
          {realSteps(report).map((step, i) => (
            <li key={i} className={step.source}>
              <span className={`chip ${step.source === 'real' ? 'info' : 'neutral'}`}>
                {step.source === 'real' ? <Landmark size={14} aria-hidden="true" /> : <FlaskConical size={14} aria-hidden="true" />}
                {step.source === 'real' ? 'Real PayPal' : 'Simulated'}
              </span>
              <div>
                <strong>{step.title}</strong>
                <p className="muted small">
                  {step.detail}{' '}
                  {step.opensTimeline && (
                    <button type="button" className="link" onClick={onOpenTimeline}>
                      See them on the Timeline
                    </button>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section className="card" aria-label="Notices from real PayPal">
        <header className="section-head">
          <h2>What real PayPal sent</h2>
          <p className="muted">Each notice reached the app byte for byte, with PayPal's own signature.</p>
        </header>
        <div className="real-notices">
          <table>
            <thead>
              <tr>
                <th scope="col">Notice</th>
                <th scope="col">App answered</th>
                <th scope="col">Signature</th>
              </tr>
            </thead>
            <tbody>
              {notices.map((n, i) => (
                <tr key={i}>
                  <td>
                    <code>{n.eventType}</code>
                    {n.duplicate && (
                      <span className="chip neutral">
                        <Copy size={14} aria-hidden="true" /> Sent again by PayPal
                      </span>
                    )}
                  </td>
                  <td>{n.appStatus ?? 'Nothing'}</td>
                  <td>{signature(n, report.certFetched)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
