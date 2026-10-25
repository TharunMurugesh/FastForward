import type { ColDef } from 'ag-grid-community';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { CircleCheck, CircleX, FastForward, FileCheck, GitCompareArrows, Info, Landmark } from 'lucide-react';
import { fmtDateYear, groupKnownDiffs } from '../format.js';
import type { FidelityCheck, FidelityFile } from '../fidelity.js';
import { gridTheme } from './theme.js';

const Match = ({ value }: CustomCellRendererProps<FidelityCheck, boolean>) =>
  value ? (
    <span className="cell-ok">
      <CircleCheck size={14} aria-hidden="true" /> match
    </span>
  ) : (
    <span className="cell-bad">
      <CircleX size={14} aria-hidden="true" /> differs
    </span>
  );

const Status = ({ value }: CustomCellRendererProps<FidelityCheck, number>) => <span className="muted">{value}</span>;

const columnDefs: ColDef<FidelityCheck>[] = [
  { field: 'step', headerName: 'Step', minWidth: 220, flex: 1 },
  { field: 'method', width: 84, cellClass: 'mono' },
  { field: 'endpoint', minWidth: 280, flex: 1, cellClass: 'mono' },
  { field: 'sandboxStatus', headerName: 'Real sandbox', width: 124, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  { field: 'twinStatus', headerName: 'Fastforward', width: 124, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  { field: 'shapeMatch', headerName: 'Response shape', width: 142, cellRenderer: Match },
  { field: 'specMatch', headerName: "PayPal's OpenAPI spec", width: 176, cellRenderer: Match },
  {
    headerName: 'Known differences',
    minWidth: 240,
    flex: 1,
    // One line per reason, so one explanation shared by four fields is written once.
    valueGetter: (p) =>
      groupKnownDiffs(p.data?.allowedDiffs ?? [])
        .map((g) => `${g.fields.join(', ')}: ${g.reason}`)
        .join('; ') || 'None',
    tooltip: (p) => String(p.value ?? ''),
    wrapText: true,
    autoHeight: true,
  },
];

const defaultColDef: ColDef<FidelityCheck> = { sortable: true, filter: true, resizable: true };

/** How closely Fastforward behaves like the real PayPal sandbox: the score first, then every step. */
export function FidelityGrid({ file, isSample }: { file: FidelityFile; isSample: boolean }) {
  const n = file.checks.length;
  const shape = file.checks.filter((c) => c.shapeMatch).length;
  const spec = file.checks.filter((c) => c.specMatch).length;
  const known = file.checks.filter((c) => c.allowedDiffs.length > 0).length;
  return (
    <section className="card" aria-label="Checked against the real PayPal sandbox">
      <header className="card-head">
        <div>
          <h2>Does Fastforward behave like real PayPal?</h2>
          <p className="muted">Last measured {fmtDateYear(file.ranAt)}. Only response shapes and status codes are compared, never values or tokens.</p>
        </div>
        {isSample && <span className="chip warn">Sample data, not a real run</span>}
      </header>
      <div className="match-how" aria-label="How it is measured">
        <span>
          <Landmark size={18} aria-hidden="true" /> Real PayPal sandbox
        </span>
        <GitCompareArrows size={18} className="muted" aria-hidden="true" />
        <span>
          <FastForward size={18} aria-hidden="true" /> Fastforward
        </span>
        <span className="muted small">the same {n} requests sent to both</span>
      </div>
      <ul className="stat-tiles">
        <li className={shape === n ? 'ok' : 'bad'}>
          <CircleCheck size={20} aria-hidden="true" />
          <strong>
            {shape}/{n}
          </strong>
          <span>responses shaped like PayPal's</span>
        </li>
        <li className={spec === n ? 'ok' : 'bad'}>
          <FileCheck size={20} aria-hidden="true" />
          <strong>
            {spec}/{n}
          </strong>
          <span>follow PayPal's published spec</span>
        </li>
        <li className="neutral">
          <Info size={20} aria-hidden="true" />
          <strong>{known}</strong>
          <span>known, explained {known === 1 ? 'difference' : 'differences'}</span>
        </li>
      </ul>
      <div className="grid-wrap">
        <AgGridReact<FidelityCheck>
          theme={gridTheme}
          rowData={file.checks}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          domLayout="autoHeight"
          suppressCellFocus
          animateRows={false}
        />
      </div>
    </section>
  );
}
