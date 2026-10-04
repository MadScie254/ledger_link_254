import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import {
  detectCsvLayout,
  isOfx,
  linesFromCsv,
  linesFromOfx,
  parseCsv,
  type CsvMapping,
  type DateFormat,
  type StatementLine,
} from '../../utils/statementImport';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

const MAX_FILE_BYTES = 5_000_000;
const shortDate = (value: string) => format(parseISO(value), 'dd/MM/yyyy');

/**
 * Reads a statement file the bank or Safaricom gives (CSV, OFX or QFX) in
 * the browser, shows what it found, and adds the lines to one money account.
 * Lines the account already has are skipped by the database, so an
 * overlapping statement adds only what is new.
 */
export function ImportStatementDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: (message: string) => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const queryClient = useQueryClient();
  const currency = activeCompany?.baseCurrency || 'KES';
  const [accountId, setAccountId] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [ofxLines, setOfxLines] = useState<StatementLine[] | null>(null);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [amountMode, setAmountMode] = useState<'single' | 'split'>('single');
  const [problem, setProblem] = useState('');

  const accounts = useQuery({ queryKey: ['accounts', currentOrgId], queryFn: () => apiRequest('/api/accounts'), enabled: open });
  const moneyAccounts: any[] = (accounts.data?.accounts || []).filter((a: any) => a.isBankAccount && a.isActive !== false);

  useEffect(() => {
    if (!open) return;
    setAccountId('');
    setFileName('');
    setRows(null);
    setOfxLines(null);
    setMapping(null);
    setProblem('');
  }, [open]);

  const readFile = async (file: File | undefined) => {
    setProblem('');
    setRows(null);
    setOfxLines(null);
    setMapping(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return setProblem('That file is over 5 MB. Export a shorter period from the bank.');
    setFileName(file.name);
    const text = await file.text();
    if (isOfx(text)) {
      const found = linesFromOfx(text);
      if (found.length === 0) return setProblem('No transactions were found in that OFX file.');
      setOfxLines(found);
      return;
    }
    const parsed = parseCsv(text);
    if (parsed.length < 2) return setProblem('That file has no rows to read. Export the statement as CSV, OFX or QFX.');
    const layout = detectCsvLayout(parsed);
    setRows(parsed);
    setHeaderRow(layout.headerRow);
    const guessed = layout.mapping || { date: 0, description: 1, amount: 2, dateFormat: 'DMY' as DateFormat };
    setMapping(guessed);
    setAmountMode(guessed.moneyIn !== undefined ? 'split' : 'single');
  };

  const header = rows ? rows[headerRow] || [] : [];
  const columnOptions = header.map((name, index) => ({ index, name: name || `Column ${index + 1}` }));
  const effectiveMapping: CsvMapping | null = useMemo(() => (mapping
    ? amountMode === 'single'
      ? { ...mapping, moneyIn: undefined, moneyOut: undefined, amount: mapping.amount ?? 0 }
      : { ...mapping, amount: undefined, moneyIn: mapping.moneyIn ?? 0, moneyOut: mapping.moneyOut ?? 0 }
    : null), [mapping, amountMode]);
  const result = useMemo(() => {
    if (ofxLines) return { lines: ofxLines, skipped: [] as Array<{ row: number; reason: string }> };
    if (rows && effectiveMapping) return linesFromCsv(rows, headerRow, effectiveMapping);
    return null;
  }, [ofxLines, rows, headerRow, effectiveMapping]);
  const found = result?.lines || [];
  const moneyIn = found.filter((l) => l.amountCents > 0).reduce((sum, l) => sum + l.amountCents, 0);
  const moneyOut = found.filter((l) => l.amountCents < 0).reduce((sum, l) => sum - l.amountCents, 0);
  const dates = found.map((l) => l.date).sort();

  const importIt = useMutation({
    mutationFn: () => {
      if (!accountId) throw new Error('Choose the account this statement is for.');
      if (found.length === 0) throw new Error('No lines were read from the file.');
      if (found.length > 5000) throw new Error('Import at most 5,000 lines at a time; export one month at a time.');
      return apiRequest<{ imported: number; skipped: number }>('/api/banking/statements', {
        body: { accountId, fileName: fileName || undefined, lines: found },
        fallback: 'The statement could not be imported.',
      });
    },
    onSuccess: (res) => {
      for (const key of ['bank_transactions', 'banking_ai_matches', 'banking_reconciliation', 'bank-statements', 'reconciliations']) {
        queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
      }
      const account = moneyAccounts.find((a) => a.id === accountId);
      onDone?.(`${res.imported} ${res.imported === 1 ? 'line' : 'lines'} imported to ${account?.name || 'the account'}${res.skipped ? `; ${res.skipped} already there and skipped` : ''}.`);
      onClose();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const columnSelect = (label: string, value: number | undefined, onChange: (index: number | undefined) => void, optional = false) => (
    <Field label={label}>
      <select value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}>
        {optional && <option value="">None</option>}
        {columnOptions.map((column) => <option key={column.index} value={column.index}>{column.name}</option>)}
      </select>
    </Field>
  );

  return (
    <Dialog
      open={open}
      onClose={() => { if (!importIt.isPending) onClose(); }}
      width="lg"
      title="Import a statement"
      note="Export the statement from online banking or the M-Pesa app as CSV, OFX or QFX. It is read here, in your browser; only the lines found are sent. Lines already imported are skipped."
      footer={
        <>
          {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
          <button type="button" onClick={onClose} disabled={importIt.isPending} className={buttonClass.secondary}>Cancel</button>
          <button type="button" onClick={() => { setProblem(''); importIt.mutate(); }} disabled={importIt.isPending || found.length === 0 || !accountId} className={buttonClass.primary}>
            {importIt.isPending ? 'Importing' : found.length ? `Import ${found.length} ${found.length === 1 ? 'line' : 'lines'}` : 'Import'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Statement for" hint={moneyAccounts.length === 0 && !accounts.isLoading ? 'Mark a bank, cash or M-Pesa account as holding money (Accounting, Edit) first.' : undefined}>
            <select name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Choose an account</option>
              {moneyAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="Statement file" hint="CSV, OFX or QFX, up to 5 MB">
            <input type="file" name="statement" accept=".csv,.txt,.ofx,.qfx,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
          </Field>
        </div>

        {rows && mapping && (
          <fieldset className="space-y-3 border-t border-feint pt-3">
            <legend className="text-[13px] font-semibold text-ink-900">Columns</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Header row" hint="The row naming the columns">
                <input type="number" min={1} max={rows.length} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, Math.min(rows.length - 1, Number(e.target.value) - 1)))} />
              </Field>
              {columnSelect('Date', mapping.date, (index) => setMapping({ ...mapping, date: index ?? 0 }))}
              <Field label="Dates written">
                <select value={mapping.dateFormat} onChange={(e) => setMapping({ ...mapping, dateFormat: e.target.value as DateFormat })}>
                  <option value="DMY">Day first, 15/09/2026</option>
                  <option value="MDY">Month first, 09/15/2026</option>
                  <option value="YMD">Year first, 2026-09-15</option>
                </select>
              </Field>
              {columnSelect('Particulars', mapping.description, (index) => setMapping({ ...mapping, description: index ?? 0 }))}
              {columnSelect('Reference', mapping.reference, (index) => setMapping({ ...mapping, reference: index }), true)}
              <Field label="Amounts">
                <select value={amountMode} onChange={(e) => setAmountMode(e.target.value as 'single' | 'split')}>
                  <option value="single">One column, money out negative</option>
                  <option value="split">Money in and money out columns</option>
                </select>
              </Field>
              {amountMode === 'single'
                ? columnSelect('Amount', effectiveMapping?.amount, (index) => setMapping({ ...mapping, amount: index ?? 0 }))
                : (
                  <>
                    {columnSelect('Money in', effectiveMapping?.moneyIn, (index) => setMapping({ ...mapping, moneyIn: index ?? 0 }))}
                    {columnSelect('Money out', effectiveMapping?.moneyOut, (index) => setMapping({ ...mapping, moneyOut: index ?? 0 }))}
                  </>
                )}
            </div>
          </fieldset>
        )}

        {result && (
          <section aria-labelledby="statement-preview" className="space-y-2">
            <h3 id="statement-preview" className="text-[13.5px] font-semibold text-ink-900">
              {found.length} {found.length === 1 ? 'line' : 'lines'} read{dates.length ? `, ${shortDate(dates[0])} to ${shortDate(dates[dates.length - 1])}` : ''}
            </h3>
            {found.length > 0 && (
              <>
                <dl className="grid grid-cols-2 gap-x-6 text-[13px] sm:max-w-sm">
                  <dt className="text-graphite-600">Money in</dt>
                  <dd className="text-right"><Amount cents={moneyIn} currency={currency} size="xs" tone="ink" /></dd>
                  <dt className="text-graphite-600">Money out</dt>
                  <dd className="text-right"><Amount cents={moneyOut} currency={currency} size="xs" tone="ink" /></dd>
                </dl>
                <ol className="border-t border-feint-strong text-[13px]" aria-label="First lines read">
                  {found.slice(0, 6).map((line, index) => (
                    <li key={index} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] gap-3 border-b border-feint py-1.5">
                      <span className="tabular-currency text-graphite-600">{shortDate(line.date)}</span>
                      <span className="truncate text-ink-900">{line.description}{line.reference ? <span className="text-graphite-600"> · {line.reference}</span> : null}</span>
                      <Amount cents={line.amountCents} currency={currency} size="xs" tone="ink" />
                    </li>
                  ))}
                </ol>
                {found.length > 6 && <p className="text-[12.5px] text-graphite-600">and {found.length - 6} more.</p>}
              </>
            )}
            {result.skipped.length > 0 && (
              <p className="text-[12.5px] text-graphite-600">
                {result.skipped.length} {result.skipped.length === 1 ? 'row was' : 'rows were'} left out: {result.skipped.slice(0, 3).map((s) => `row ${s.row}, ${s.reason}`).join('; ')}{result.skipped.length > 3 ? '; and more' : ''}. Opening and closing balance rows are left out this way.
              </p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}
