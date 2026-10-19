import type { CheckId } from '@fastforward/contracts';
import type { ColDef, GridApi, GridReadyEvent, IRowNode, RowClassRules, RowSelectionOptions } from 'ag-grid-community';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CHECK_SHORT, CHECK_TITLES, EVENT_LABELS, fmtDateTime } from '../format.js';
import { ACK_LIMIT_MS, isFailing, type DeliveryRow, type NoticeRow } from './rows.js';
import { gridTheme } from './theme.js';

interface Props {
  /** Every delivery attempt. */
  rows: DeliveryRow[];
  /** The same deliveries boiled down to one row per notice (the default view). */
  notices: NoticeRow[];
  selectedEventId: string | null;
  onSelect: (eventId: string | null) => void;
  /** Show only rows that are evidence for this check (set from the report). */
  checkFilter: CheckId | null;
  onClearCheck: () => void;
}

function Status({ value }: CustomCellRendererProps<DeliveryRow, number | null>) {
  if (value === null || value === undefined) return <span className="chip bad">timed out</span>;
  return <span className={`chip ${value < 300 ? 'ok' : 'bad'}`}>{value}</span>;
}

function Verified({ value }: CustomCellRendererProps<DeliveryRow, boolean>) {
  return value ? <span className="chip ok">✓ checked</span> : <span className="chip warn">✗ not checked</span>;
}

function Tries({ data }: CustomCellRendererProps<DeliveryRow>) {
  const tries = (data as NoticeRow | undefined)?.tries ?? 1;
  return tries > 1 ? <span className="chip warn">{tries} tries</span> : <span className="muted">1 try</span>;
}

/** Only worth showing when something went worse earlier than the last answer. */
function Worst({ data }: CustomCellRendererProps<DeliveryRow>) {
  const n = data as NoticeRow | undefined;
  if (!n || n.worstStatus === n.status) return <span className="muted">–</span>;
  if (n.worstStatus === null) return <span className="chip bad">timed out</span>;
  return <span className={`chip ${n.worstStatus < 300 ? 'ok' : 'bad'}`}>{n.worstStatus}</span>;
}

/** Duplicate and forged flags, then the checks this row is evidence for: everything worth a look in one cell. */
function Findings({ data }: CustomCellRendererProps<DeliveryRow>) {
  if (!data) return null;
  return (
    <span className="chips">
      {data.forged && <span className="chip warn">forged</span>}
      {data.duplicate && <span className="chip info">duplicate</span>}
      {data.failedChecks.map((id) => (
        <span key={id} className="chip bad" title={`${CHECK_TITLES[id]} (${id})`}>
          {CHECK_SHORT[id]}
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

const eventColumn: ColDef<DeliveryRow> = {
  field: 'eventType',
  headerName: 'Event',
  width: 160,
  valueFormatter: (p) => EVENT_LABELS[p.value as string] ?? String(p.value ?? ''),
  tooltip: (p) => p.data?.eventType ?? '',
  filterValueGetter: (p) => `${p.data?.eventType ?? ''} ${EVENT_LABELS[p.data?.eventType ?? ''] ?? ''}`,
};

const findingsColumn: ColDef<DeliveryRow> = {
  headerName: 'Findings',
  minWidth: 200,
  flex: 1,
  cellRenderer: Findings,
  sortable: false,
  filterValueGetter: (p) => [p.data?.forged ? 'forged' : '', p.data?.duplicate ? 'duplicate' : '', ...(p.data?.failedChecks ?? []).flatMap((id) => [id, CHECK_SHORT[id]])].filter(Boolean).join(' '),
};

const signatureColumn: ColDef<DeliveryRow> = {
  field: 'verified',
  headerName: 'Signature',
  width: 140,
  cellRenderer: Verified,
  filter: 'agTextColumnFilter',
  filterValueGetter: (p) => (p.data?.verified ? 'checked' : 'not checked'),
};

const whenColumn = (headerName: string): ColDef<DeliveryRow> => ({
  field: 'at',
  headerName,
  width: 134,
  sort: 'asc',
  valueFormatter: (p) => (p.value ? fmtDateTime(p.value as string) : ''),
  filter: 'agTextColumnFilter',
});

// One row per notice: the story of each notice at a glance. Most useful columns first; the rest scroll sideways.
const noticeColumns: ColDef<DeliveryRow>[] = [
  whenColumn('First sent (virtual)'),
  { field: 'customer', width: 84 },
  eventColumn,
  { field: 'status', headerName: 'Last answer', width: 108, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  { headerName: 'Tries', width: 82, cellRenderer: Tries, valueGetter: (p) => (p.data as NoticeRow | undefined)?.tries ?? 1, filter: 'agNumberColumnFilter' },
  { headerName: 'Worst', width: 92, cellRenderer: Worst, valueGetter: (p) => (p.data as NoticeRow | undefined)?.worstStatus ?? null, filter: 'agNumberColumnFilter' },
  findingsColumn,
  signatureColumn,
  { field: 'eventId', headerName: 'Event id', width: 150, cellClass: 'mono' },
];

// Every attempt to deliver every notice.
const attemptColumns: ColDef<DeliveryRow>[] = [
  whenColumn('When (virtual)'),
  { field: 'customer', width: 84 },
  eventColumn,
  { field: 'status', headerName: 'App answered', width: 130, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  {
    field: 'ms',
    headerName: 'Took (ms)',
    width: 108,
    filter: 'agNumberColumnFilter',
    valueFormatter: (p) => (typeof p.value === 'number' ? p.value.toLocaleString('en-GB') : ''),
    cellClassRules: { 'cell-slow': (p) => typeof p.value === 'number' && p.value > ACK_LIMIT_MS },
  },
  findingsColumn,
  { field: 'attempt', headerName: 'Try', width: 76, filter: 'agNumberColumnFilter' },
  signatureColumn,
  { field: 'eventId', headerName: 'Event id', width: 150, cellClass: 'mono' },
];

const defaultColDef: ColDef<DeliveryRow> = { sortable: true, filter: true, resizable: true };

export function DeliveriesGrid({ rows, notices, selectedEventId, onSelect, checkFilter, onClearCheck }: Props) {
  const api = useRef<GridApi<DeliveryRow> | null>(null);
  const [quick, setQuick] = useState('');
  const [failingOnly, setFailingOnly] = useState(false);
  const [everyAttempt, setEveryAttempt] = useState(false);
  const shownRows: DeliveryRow[] = everyAttempt ? rows : notices;
  const [shown, setShown] = useState(shownRows.length);

  const failingCount = useMemo(() => shownRows.filter(isFailing).length, [shownRows]);

  // A new function identity makes the grid re-run the external filter.
  const isExternalFilterPresent = useCallback(() => failingOnly || checkFilter !== null, [failingOnly, checkFilter]);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<DeliveryRow>) => {
      const row = node.data;
      if (!row) return false;
      if (checkFilter && !row.failedChecks.includes(checkFilter)) return false;
      return !failingOnly || isFailing(row);
    },
    [failingOnly, checkFilter],
  );

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
  }, [selectedEventId, shownRows]);

  return (
    <section className="card grid-card" aria-label="Deliveries">
      <header className="card-head">
        <div>
          <h2>Deliveries</h2>
          <p className="muted">
            {everyAttempt
              ? 'Every attempt to deliver a notice to your app, and what your app did with it.'
              : 'One row per notice PayPal sent your app, with how its delivery ended. Select one to see every attempt.'}
          </p>
        </div>
        <div className="grid-tools">
          <input type="search" placeholder="Search deliveries…" aria-label="Search deliveries" value={quick} onChange={(e) => setQuick(e.target.value)} />
          <label className="toggle">
            <input type="checkbox" checked={failingOnly} onChange={(e) => setFailingOnly(e.target.checked)} />
            Failing checks only <span className="count">{failingCount}</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={everyAttempt} onChange={(e) => setEveryAttempt(e.target.checked)} />
            Show every attempt <span className="count">{rows.length}</span>
          </label>
        </div>
      </header>
      {checkFilter && (
        <p className="filter-chip" role="status">
          Showing evidence for <strong>{CHECK_TITLES[checkFilter]}</strong> <span className="mono">{checkFilter}</span>
          <button type="button" className="link" onClick={onClearCheck}>
            Show all
          </button>
        </p>
      )}
      <div className="grid-wrap">
        <AgGridReact<DeliveryRow>
          theme={gridTheme}
          rowData={shownRows}
          columnDefs={everyAttempt ? attemptColumns : noticeColumns}
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
          overlayNoRowsTemplate="Nothing to show. Move the date forward to let events happen, or clear a filter."
        />
      </div>
      <footer className="grid-foot muted">
        Showing {shown} of {shownRows.length} {everyAttempt ? 'delivery attempts' : 'notices'}
      </footer>
    </section>
  );
}
