import type { GridApi, ColDef, GridReadyEvent, IRowNode, RowClassRules, RowSelectionOptions } from 'ag-grid-community';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHECK_TITLES, EVENT_LABELS, fmtDateTime } from '../format.js';
import { ACK_LIMIT_MS, isFailing, type DeliveryRow } from './rows.js';
import { gridTheme } from './theme.js';

interface Props {
  rows: DeliveryRow[];
  selectedEventId: string | null;
  onSelect: (eventId: string | null) => void;
}

function Status({ value }: CustomCellRendererProps<DeliveryRow, number | null>) {
  if (value === null || value === undefined) return <span className="chip bad">timed out</span>;
  return <span className={`chip ${value < 300 ? 'ok' : 'bad'}`}>{value}</span>;
}

function Verified({ value }: CustomCellRendererProps<DeliveryRow, boolean>) {
  return value ? <span className="chip ok">✓ checked</span> : <span className="chip warn">✗ not checked</span>;
}

/** Duplicate and forged flags, then the checks this delivery is evidence for: everything worth a look in one cell. */
function Findings({ data }: CustomCellRendererProps<DeliveryRow>) {
  if (!data) return null;
  return (
    <span className="chips">
      {data.forged && <span className="chip warn">forged</span>}
      {data.duplicate && <span className="chip info">duplicate</span>}
      {data.failedChecks.map((id) => (
        <span key={id} className="chip bad" title={CHECK_TITLES[id]}>
          {id}
        </span>
      ))}
    </span>
  );
}

const rowClassRules: RowClassRules<DeliveryRow> = {
  'row-failing': (p) => !!p.data && isFailing(p.data),
  'row-forged': (p) => !!p.data && p.data.forged && !isFailing(p.data),
  'row-duplicate': (p) => !!p.data && p.data.duplicate && !p.data.forged && !isFailing(p.data),
};

const rowSelection: RowSelectionOptions = { mode: 'singleRow', enableClickSelection: true, checkboxes: false };

// Most useful columns first: on a narrower screen the grid scrolls sideways and the rest follow.
const columnDefs: ColDef<DeliveryRow>[] = [
  { field: 'at', headerName: 'When (virtual)', width: 150, sort: 'asc', valueFormatter: (p) => (p.value ? fmtDateTime(p.value as string) : ''), filter: 'agTextColumnFilter' },
  { field: 'customer', width: 96 },
  {
    field: 'eventType',
    headerName: 'Event',
    width: 190,
    valueFormatter: (p) => EVENT_LABELS[p.value as string] ?? String(p.value ?? ''),
    tooltip: (p) => p.data?.eventType ?? '',
    filterValueGetter: (p) => `${p.data?.eventType ?? ''} ${EVENT_LABELS[p.data?.eventType ?? ''] ?? ''}`,
  },
  { field: 'status', headerName: 'App answered', width: 138, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  {
    field: 'ms',
    headerName: 'Took (ms)',
    width: 112,
    filter: 'agNumberColumnFilter',
    valueFormatter: (p) => (typeof p.value === 'number' ? p.value.toLocaleString('en-GB') : ''),
    cellClassRules: { 'cell-slow': (p) => typeof p.value === 'number' && p.value > ACK_LIMIT_MS },
  },
  {
    headerName: 'Findings',
    minWidth: 200,
    flex: 1,
    cellRenderer: Findings,
    sortable: false,
    filterValueGetter: (p) => [p.data?.forged ? 'forged' : '', p.data?.duplicate ? 'duplicate' : '', ...(p.data?.failedChecks ?? [])].filter(Boolean).join(' '),
  },
  { field: 'verified', headerName: 'Signature', width: 140, cellRenderer: Verified, filter: 'agTextColumnFilter', filterValueGetter: (p) => (p.data?.verified ? 'checked' : 'not checked') },
  { field: 'attempt', headerName: 'Try', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'eventId', headerName: 'Event id', width: 150, cellClass: 'mono' },
];

const defaultColDef: ColDef<DeliveryRow> = { sortable: true, filter: true, resizable: true };

export function DeliveriesGrid({ rows, selectedEventId, onSelect }: Props) {
  const api = useRef<GridApi<DeliveryRow> | null>(null);
  const [quick, setQuick] = useState('');
  const [failingOnly, setFailingOnly] = useState(false);
  const [shown, setShown] = useState(rows.length);

  const failingCount = useMemo(() => rows.filter(isFailing).length, [rows]);

  // A new function identity makes the grid re-run the external filter.
  const isExternalFilterPresent = useCallback(() => failingOnly, [failingOnly]);
  const doesExternalFilterPass = useCallback((node: IRowNode<DeliveryRow>) => !failingOnly || (!!node.data && isFailing(node.data)), [failingOnly]);

  const countShown = useCallback(() => setShown(api.current?.getDisplayedRowCount() ?? 0), []);

  const onGridReady = useCallback((e: GridReadyEvent<DeliveryRow>) => {
    api.current = e.api;
  }, []);

  // Selecting a marker on the timeline selects and reveals the matching row.
  useEffect(() => {
    const grid = api.current;
    if (!grid || !selectedEventId) return;
    const current = grid.getSelectedRows()[0];
    if (current?.eventId === selectedEventId) return;
    let target: IRowNode<DeliveryRow> | undefined;
    grid.forEachNodeAfterFilterAndSort((n) => {
      if (!target && n.data?.eventId === selectedEventId) target = n;
    });
    if (target) {
      target.setSelected(true);
      grid.ensureNodeVisible(target, 'middle');
    }
  }, [selectedEventId, rows]);

  return (
    <section className="card grid-card" aria-label="Deliveries">
      <header className="card-head">
        <div>
          <h2>Deliveries</h2>
          <p className="muted">Every time PayPal's simulator sent your app a notice, and what your app did with it.</p>
        </div>
        <div className="grid-tools">
          <input
            type="search"
            placeholder="Search deliveries…"
            aria-label="Search deliveries"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
          />
          <label className="toggle">
            <input type="checkbox" checked={failingOnly} onChange={(e) => setFailingOnly(e.target.checked)} />
            Failing checks only <span className="count">{failingCount}</span>
          </label>
        </div>
      </header>
      <div className="grid-wrap">
        <AgGridReact<DeliveryRow>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.id}
          rowClassRules={rowClassRules}
          rowSelection={rowSelection}
          quickFilterText={quick}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          onGridReady={onGridReady}
          onModelUpdated={countShown}
          onSelectionChanged={(e) => onSelect(e.api.getSelectedRows()[0]?.eventId ?? null)}
          rowHeight={38}
          headerHeight={40}
          animateRows={false}
          overlayNoRowsTemplate="No deliveries yet. Move the date forward to let events happen."
        />
      </div>
      <footer className="grid-foot muted">
        Showing {shown} of {rows.length} deliveries
      </footer>
    </section>
  );
}
