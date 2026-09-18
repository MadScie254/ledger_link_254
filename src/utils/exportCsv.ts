export type CsvCell = string | number | boolean | null | undefined;

function quoteCell(value: CsvCell): string {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Download a UTF-8 RFC 4180 CSV without a third-party spreadsheet parser. */
export function downloadCsv(filename: string, rows: readonly (readonly CsvCell[])[]): void {
  const safeName = filename.replace(/[^a-z0-9._-]+/gi, '_').replace(/_+/g, '_');
  const csv = rows.map((row) => row.map(quoteCell).join(',')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
