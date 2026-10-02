export type CsvCell = string | number | boolean | null | undefined;

// A cell starting with one of these is run as a formula by Excel, LibreOffice
// and Google Sheets. Customer and supplier names are typed by users, so a
// name like =HYPERLINK(...) must arrive as text.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d[\d,]*(\.\d+)?$/;

function quoteCell(value: CsvCell): string {
  let text = value == null ? '' : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV text: quoted where needed, formula-like text neutralised, CRLF rows. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map((row) => row.map(quoteCell).join(',')).join('\r\n');
}

/** Download a UTF-8 RFC 4180 CSV without a third-party spreadsheet parser. */
export function downloadCsv(filename: string, rows: readonly (readonly CsvCell[])[]): void {
  const safeName = filename.replace(/[^a-z0-9._-]+/gi, '_').replace(/_+/g, '_');
  const csv = toCsv(rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName.toLowerCase().endsWith('.csv') ? safeName : `${safeName}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
