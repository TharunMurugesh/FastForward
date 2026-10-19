import { themeQuartz } from 'ag-grid-community';

/**
 * AG Grid Community only (MIT). The default colour scheme follows `data-ag-theme-mode` on <html>,
 * which main.tsx keeps in step with the operating system's light or dark setting.
 */
export const gridTheme = themeQuartz.withParams({
  accentColor: '#0b6bcb',
  fontFamily: 'inherit',
  fontSize: 13,
  headerFontWeight: 600,
});
