import type { ColDef } from 'ag-grid-community';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { useState } from 'react';
import { fmtDateYear, groupKnownDiffs } from '../format.js';
import type { FidelityCheck, FidelityFile } from '../fidelity.js';
import { gridTheme } from './theme.js';

const Match = ({ value }: CustomCellRendererProps<FidelityCheck, boolean>) =>
  value ? <span className="chip ok">✓ match</span> : <span className="chip bad">✗ differs</span>;

const Status = ({ value }: CustomCellRendererProps<FidelityCheck, number>) => <span className="chip neutral">{value}</span>;

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

export function FidelityGrid({ file, isSample }: { file: FidelityFile; isSample: boolean }) {
  const matching = file.checks.filter((c) => c.shapeMatch && c.specMatch).length;
  const known = file.checks.filter((c) => c.allowedDiffs.length > 0).length;
  const [open, setOpen] = useState(false);
  return (
    <section className="card" aria-label="Checked against the real PayPal sandbox">
      <header className="card-head">
        <div>
          <h2>
            <span className={`status ${matching === file.checks.length ? 'pass' : 'fail'}`} aria-hidden="true">
              {matching === file.checks.length ? '✓' : '✗'}
            </span>{' '}
            {matching} of {file.checks.length} steps match the real PayPal sandbox
          </h2>
          <p className="muted">
            The same requests were sent to PayPal's sandbox and to Fastforward; only response shapes and status codes are compared, never values or
            tokens.{known > 0 && ` ${known} known, explained ${known === 1 ? 'difference' : 'differences'}.`} Last run {fmtDateYear(file.ranAt)}.
          </p>
        </div>
        <div className="card-actions">
          {isSample && <span className="chip warn">Sample data, not a real run</span>}
          <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide the steps' : `Show the ${file.checks.length} steps`}
          </button>
        </div>
      </header>
      {open && (
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
      )}
    </section>
  );
}
