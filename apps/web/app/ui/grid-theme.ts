import { themeQuartz } from 'ag-grid-community';

/** AG Grid themed with Vigil's CSS tokens, so it follows light and dark mode. */
export const vigilGridTheme = themeQuartz.withParams({
  fontFamily: 'inherit',
  fontSize: 14,
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--ink)',
  borderColor: 'var(--line)',
  headerBackgroundColor: 'var(--surface-2)',
  headerTextColor: 'var(--muted)',
  headerFontWeight: 600,
  accentColor: 'var(--teal)',
  rowHoverColor: 'var(--hover)',
  selectedRowBackgroundColor: 'var(--selected)',
  oddRowBackgroundColor: 'var(--surface)',
  wrapperBorderRadius: 10,
  rowHeight: 52,
  headerHeight: 42,
});
