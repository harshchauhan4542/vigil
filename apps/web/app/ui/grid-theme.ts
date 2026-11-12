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
  // Banking-style list: tall rows, no vertical lines, soft header, rounded wrapper.
  wrapperBorder: false,
  wrapperBorderRadius: 14,
  columnBorder: false,
  headerColumnBorder: false,
  headerRowBorder: { color: 'var(--line)' },
  rowBorder: { color: 'var(--line)' },
  rowHeight: 60,
  headerHeight: 46,
  cellHorizontalPadding: 18,
});
