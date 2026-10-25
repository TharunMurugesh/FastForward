import type { CheckId } from '@fastforward/contracts';
import type { ColDef, GridApi, GridReadyEvent, IRowNode, RowSelectionOptions } from 'ag-grid-community';
import { AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import { CircleX, Clock, Copy, RefreshCw, ShieldCheck, ShieldOff, ShieldX, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckBadge, CheckChip } from '../checkLook.js';
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

/** Shared with the cell renderers through the grid's context, so they can fade what is not being looked at. */
interface GridContext {
  checkFilter: CheckId | null;
}
type Cell<V = unknown> = CustomCellRendererProps<DeliveryRow, V, GridContext>;

/** An answer is only worth colour when it went wrong: a normal 200 stays quiet grey. */
function Answer({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined)
    return (
      <span className="cell-bad">
        <Clock size={13} aria-hidden="true" /> timed out
      </span>
    );
  if (value >= 300)
    return (
      <span className="cell-bad">
        <CircleX size={13} aria-hidden="true" /> {value}
      </span>
    );
  return <span className="muted">{value}</span>;
}

const Status = ({ value }: Cell<number | null>) => <Answer value={value} />;

function Verified({ value, context }: Cell<boolean>) {
  if (value)
    return (
      <span className="cell-ok">
        <ShieldCheck size={14} aria-hidden="true" /> checked
      </span>
    );
  const dim = context?.checkFilter !== null && context?.checkFilter !== undefined && context.checkFilter !== 'VERIFIES_SIGNATURES';
  return (
    <span className={`cell-tone tone-sig${dim ? ' dim' : ''}`}>
      <ShieldOff size={14} aria-hidden="true" /> not checked
    </span>
  );
}

function Tries({ data }: Cell) {
  const tries = (data as NoticeRow | undefined)?.tries ?? 1;
  return tries > 1 ? (
    <span className="cell-warn">
      <RefreshCw size={13} aria-hidden="true" /> {tries}
    </span>
  ) : (
    <span className="muted">1</span>
  );
}

/** Only worth showing when something went worse earlier than the last answer. */
function Worst({ data }: Cell) {
  const n = data as NoticeRow | undefined;
  if (!n || n.worstStatus === n.status) return <span className="muted">–</span>;
  return <Answer value={n.worstStatus} />;
}

/**
 * Copy and forged flags, then the checks this row is evidence for. The signature check is left out here: the
 * Signature column already says it on every row, and repeating it is what turned the whole table red.
 */
function Findings({ data, context }: Cell) {
  if (!data) return null;
  const focus = context?.checkFilter ?? null;
  return (
    <span className="chips">
      {data.forged && (
        <span className="flag-chip" title="A deliberately fake notice with a bad signature">
          <ShieldX size={13} aria-hidden="true" /> forged
        </span>
      )}
      {data.duplicate && (
        <span className="flag-chip" title="An extra copy of a notice PayPal already delivered">
          <Copy size={13} aria-hidden="true" /> copy
        </span>
      )}
      {data.failedChecks
        .filter((id) => id !== 'VERIFIES_SIGNATURES')
        .map((id) => (
          <CheckChip key={id} id={id} title={`${CHECK_TITLES[id]} (${id})`} dim={focus !== null && focus !== id} />
        ))}
    </span>
  );
}

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
  filterValueGetter: (p) => [p.data?.forged ? 'forged' : '', p.data?.duplicate ? 'duplicate copy' : '', ...(p.data?.failedChecks ?? []).flatMap((id) => [id, CHECK_SHORT[id]])].filter(Boolean).join(' '),
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
  findingsColumn,
  { field: 'status', headerName: 'Last answer', width: 108, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  { headerName: 'Tries', width: 82, cellRenderer: Tries, valueGetter: (p) => (p.data as NoticeRow | undefined)?.tries ?? 1, filter: 'agNumberColumnFilter' },
  signatureColumn,
  { headerName: 'Worst', width: 92, cellRenderer: Worst, valueGetter: (p) => (p.data as NoticeRow | undefined)?.worstStatus ?? null, filter: 'agNumberColumnFilter' },
  { field: 'eventId', headerName: 'Event id', width: 150, cellClass: 'mono' },
];

// Every attempt to deliver every notice.
const attemptColumns: ColDef<DeliveryRow>[] = [
  whenColumn('When (virtual)'),
  { field: 'customer', width: 84 },
  eventColumn,
  findingsColumn,
  { field: 'status', headerName: 'App answered', width: 130, cellRenderer: Status, filter: 'agNumberColumnFilter' },
  {
    field: 'ms',
    headerName: 'Took (ms)',
    width: 108,
    filter: 'agNumberColumnFilter',
    valueFormatter: (p) => (typeof p.value === 'number' ? p.value.toLocaleString('en-GB') : ''),
    cellClassRules: { 'cell-slow': (p) => typeof p.value === 'number' && p.value > ACK_LIMIT_MS },
  },
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

  // The renderers read the focused check from the context; redraw them when it changes.
  const context = useMemo<GridContext>(() => ({ checkFilter }), [checkFilter]);
  useEffect(() => {
    api.current?.refreshCells({ force: true });
  }, [context]);

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
    <section className="card grid-card" id="deliveries" aria-label="Deliveries">
      <header className="card-head">
        <div>
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
          <CheckBadge id={checkFilter} size="sm" />
          Showing the notices behind <strong>{CHECK_TITLES[checkFilter]}</strong>
          <button type="button" className="clear" onClick={onClearCheck}>
            <X size={14} aria-hidden="true" /> Show all
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
          context={context}
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
