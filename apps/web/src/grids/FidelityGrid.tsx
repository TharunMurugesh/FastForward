import type { ColDef } from 'ag-grid-community';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { fmtDateYear } from '../format.js';
import type { FidelityCheck, FidelityFile } from '../fidelity.js';
import { gridTheme } from './theme.js';

const Match = ({ value }: CustomCellRendererProps<FidelityCheck, boolean>) =>
  value ? <span className="chip ok">✓ match</span> : <span className="chip bad">✗ differs</span>;

const Status = ({ value }: CustomCellRendererProps<FidelityCheck, number>) => <span className="chip neutral">{value}</span>;

const columnDefs: ColDef<FidelityCheck>[] = [
  { field: 'method', width: 84, cellClass: 'mono' },
  { field: 'endpoint', minWidth: 300, flex: 1, cellClass: 'mono' },
  { field: 'sandboxStatus', headerName: 'Real sandbox', width: 124, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  { field: 'twinStatus', headerName: 'Fastforward', width: 124, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  { field: 'shapeMatch', headerName: 'Response shape', width: 142, cellRenderer: Match },
  { field: 'specMatch', headerName: "PayPal's OpenAPI spec", width: 176, cellRenderer: Match },
  {
    headerName: 'Known differences',
    minWidth: 240,
    flex: 1,
    valueGetter: (p) => p.data?.allowedDiffs.map((d) => `${d.field}: ${d.reason}`).join('; ') || 'None',
    tooltip: (p) => String(p.value ?? ''),
    wrapText: true,
    autoHeight: true,
  },
];

const defaultColDef: ColDef<FidelityCheck> = { sortable: true, filter: true, resizable: true };

export function FidelityGrid({ file, isSample }: { file: FidelityFile; isSample: boolean }) {
  const matching = file.checks.filter((c) => c.shapeMatch && c.specMatch).length;
  const known = file.checks.filter((c) => c.allowedDiffs.length > 0).length;
  return (
    <section className="card" aria-label="Checked against the real PayPal sandbox">
      <header className="card-head">
        <div>
          <h2>Checked against the real PayPal sandbox</h2>
          <p className="muted">
            The same requests were sent to PayPal's sandbox and to Fastforward; only response shapes and status codes are compared, never values or
            tokens. {matching} of {file.checks.length} endpoints match PayPal's shape
            {known > 0 && ` (${known} known, explained ${known === 1 ? 'difference' : 'differences'})`}. Last run {fmtDateYear(file.ranAt)}.
          </p>
        </div>
        {isSample && <span className="chip warn">Sample data, not a real run</span>}
      </header>
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
