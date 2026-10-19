import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ExternalFilterModule,
  NumberFilterModule,
  QuickFilterModule,
  RowApiModule,
  RowAutoHeightModule,
  RowSelectionModule,
  RowStyleModule,
  ScrollApiModule,
  TextFilterModule,
  TooltipModule,
  enableDevValidations,
  type Module,
} from 'ag-grid-community';

/**
 * Only the AG Grid Community modules the dashboard uses, instead of AllCommunityModule (about 16%
 * smaller; the rest of the bundle is the grid core). Community only, MIT: never the Enterprise modules (commercial licence).
 *   filters: text and number column filters, the quick-filter search box, the external "failing only" filter
 *   RowSelectionModule: click a row to open the inspector
 *   CellStyleModule / RowStyleModule: cellClassRules and rowClassRules (tints, slow-answer colour)
 *   TooltipModule: full event name on hover; RowAutoHeightModule: wrapped cells in the fidelity grid
 *   RowApiModule / ClientSideRowModelApiModule / ScrollApiModule: select a row and scroll to it from the timeline
 * Sorting, column resizing, custom cell renderers and getRowId are part of the core.
 * Using a feature whose module is missing is reported in the console while developing (dev validation below).
 */
export const gridModules: Module[] = [
  TextFilterModule,
  NumberFilterModule,
  QuickFilterModule,
  ExternalFilterModule,
  RowSelectionModule,
  CellStyleModule,
  RowStyleModule,
  TooltipModule,
  RowAutoHeightModule,
  RowApiModule,
  ClientSideRowModelApiModule,
  ScrollApiModule,
];

if (import.meta.env.DEV) enableDevValidations();
