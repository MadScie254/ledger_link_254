import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { parseCsv, parseStatementAmount } from '../../utils/statementImport';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

export type ImportTarget = 'customers' | 'vendors' | 'items';
type Conversion = 'text' | 'amount' | 'number' | 'integer';
interface FieldSpec { key: string; label: string; required?: boolean; type?: Conversion; hint: RegExp }

const PARTY_FIELDS: FieldSpec[] = [
  { key: 'legalName', label: 'Legal name', hint: /^legal( name)?$/i },
  { key: 'contactPerson', label: 'Contact person', hint: /contact/i },
  { key: 'email', label: 'Email', hint: /e-?mail/i },
  { key: 'phone', label: 'Phone', hint: /phone|mobile|tel/i },
  { key: 'kraPin', label: 'KRA PIN', hint: /\bpin\b|kra|tax ?id/i },
  { key: 'city', label: 'City or town', hint: /^(city|town)$/i },
  { key: 'paymentTerms', label: 'Payment terms', hint: /terms/i },
  { key: 'notes', label: 'Notes', hint: /^(notes?|memo|comments?)$/i },
];

const TARGETS: Record<ImportTarget, { title: string; noun: string; many: string; listKey: string; fields: FieldSpec[] }> = {
  customers: {
    title: 'Import customers',
    noun: 'customer',
    many: 'customers',
    listKey: 'customers',
    fields: [
      { key: 'displayName', label: 'Name', required: true, hint: /^(name|customer( name)?|display name|company( name)?|business( name)?|client( name)?)$/i },
      ...PARTY_FIELDS,
      { key: 'billingAddress', label: 'Address', hint: /address/i },
      { key: 'creditLimitCents', label: 'Credit limit', type: 'amount', hint: /credit ?limit/i },
    ],
  },
  vendors: {
    title: 'Import suppliers',
    noun: 'supplier',
    many: 'suppliers',
    listKey: 'vendors',
    fields: [
      { key: 'displayName', label: 'Name', required: true, hint: /^(name|supplier( name)?|vendor( name)?|display name|company( name)?|business( name)?)$/i },
      ...PARTY_FIELDS,
      { key: 'billingAddress', label: 'Address', hint: /address/i },
      { key: 'bankName', label: 'Bank', hint: /^bank( name)?$/i },
      { key: 'bankAccountNo', label: 'Bank account number', hint: /account (no|number)|acc(ount)? ?no/i },
      { key: 'mpesaNumber', label: 'M-Pesa number', hint: /m-?pesa|till|paybill/i },
    ],
  },
  items: {
    title: 'Import stock items',
    noun: 'stock item',
    many: 'stock items',
    listKey: 'inventory',
    fields: [
      { key: 'name', label: 'Name', required: true, hint: /^(name|item( name)?|product( name)?|description)$/i },
      { key: 'sku', label: 'SKU or code', hint: /^(sku|code|item code|product code)$/i },
      { key: 'itemType', label: 'Type', hint: /^(type|item type)$/i },
      { key: 'category', label: 'Category', hint: /categor/i },
      { key: 'unitOfMeasure', label: 'Unit', hint: /^(unit|uom|unit of measure)$/i },
      { key: 'priceCents', label: 'Selling price', type: 'amount', hint: /(selling |sale |unit )?price|rate/i },
      { key: 'costCents', label: 'Cost', type: 'amount', hint: /cost|buying price|purchase price/i },
      { key: 'taxRate', label: 'VAT %', type: 'number', hint: /vat|tax/i },
      { key: 'quantityOnHand', label: 'Quantity on hand', type: 'integer', hint: /qty|quantity|on hand|stock/i },
      { key: 'reorderPoint', label: 'Reorder at', type: 'integer', hint: /reorder/i },
    ],
  },
};

function convert(raw: string, type: Conversion = 'text'): unknown {
  const value = raw.trim();
  if (value === '') return undefined;
  if (type === 'amount') {
    const cents = parseStatementAmount(value);
    return cents === null ? value : Math.abs(cents);
  }
  if (type === 'number') {
    const number = Number(value.replace(/%$/, '').replace(/,/g, ''));
    return Number.isFinite(number) ? number : value;
  }
  if (type === 'integer') {
    const number = Number(value.replace(/,/g, ''));
    return Number.isFinite(number) ? Math.trunc(number) : value;
  }
  return value;
}

/**
 * Customers, suppliers or stock items from a spreadsheet saved as CSV. The
 * columns are matched by their headings and can be changed; every row is
 * checked on the server by the same rules as the form, and names already in
 * the books are skipped.
 */
export function ImportRecordsDialog({ target, open, onClose, onDone }: { target: ImportTarget; open: boolean; onClose: () => void; onDone?: (message: string) => void }) {
  const { currentOrgId } = useAppStore();
  const queryClient = useQueryClient();
  const spec = TARGETS[target];
  const [rows, setRows] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Record<string, number | undefined>>({});
  const [problem, setProblem] = useState('');
  const [problems, setProblems] = useState<Array<{ row: number; reason: string }>>([]);

  useEffect(() => {
    if (!open) return;
    setRows(null);
    setMapping({});
    setProblem('');
    setProblems([]);
  }, [open]);

  const readFile = async (file: File | undefined) => {
    setProblem('');
    setProblems([]);
    setRows(null);
    if (!file) return;
    if (file.size > 5_000_000) return setProblem('That file is over 5 MB.');
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setProblem('The file needs a row of column headings and at least one row below it. Save the sheet as CSV.');
    const header = parsed[0];
    const guessed: Record<string, number | undefined> = {};
    const used = new Set<number>();
    for (const field of spec.fields) {
      const index = header.findIndex((cell, i) => !used.has(i) && field.hint.test(cell.trim()));
      if (index !== -1) { guessed[field.key] = index; used.add(index); }
    }
    setMapping(guessed);
    setRows(parsed);
  };

  const header = rows?.[0] || [];
  const records = useMemo(() => (rows || []).slice(1).map((row, index) => {
    const values: Record<string, unknown> = {};
    for (const field of spec.fields) {
      const column = mapping[field.key];
      if (column === undefined) continue;
      const value = convert(row[column] || '', field.type);
      if (value !== undefined) values[field.key] = value;
    }
    return { row: index + 2, values };
  }).filter((record) => Object.keys(record.values).length > 0), [rows, mapping, spec.fields]);
  const nameKey = spec.fields.find((f) => f.required)!.key;

  const importIt = useMutation({
    mutationFn: async (skipInvalid: boolean) => {
      if (mapping[nameKey] === undefined) throw new Error('Choose the column that holds the name.');
      if (records.length > 2000) throw new Error('Import at most 2,000 rows at a time.');
      const response = await fetch(`/api/imports/${target}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: records, skipInvalid }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 422 && Array.isArray(data.problems)) {
        setProblems(data.problems);
        throw new Error(data.error);
      }
      if (!response.ok) throw new Error(data.error || `The ${spec.many} could not be imported.`);
      return data as { imported: number; skipped: Array<{ row: number; name: string }>; problems: Array<{ row: number }> };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [spec.listKey, currentOrgId] });
      const parts = [`${result.imported} ${result.imported === 1 ? spec.noun : spec.many} added`];
      if (result.skipped.length) parts.push(`${result.skipped.length} already in the books and skipped`);
      if (result.problems.length) parts.push(`${result.problems.length} with problems left out`);
      onDone?.(`${parts.join('; ')}.`);
      onClose();
    },
    onError: (err: Error) => setProblem(err.message),
  });

  return (
    <Dialog
      open={open}
      onClose={() => { if (!importIt.isPending) onClose(); }}
      width="lg"
      title={spec.title}
      note={`Save the spreadsheet as CSV with a row of column headings. Each row is checked as the form would check it, and a ${spec.noun} whose name is already in the books is skipped.`}
      footer={
        <>
          {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
          <button type="button" onClick={onClose} disabled={importIt.isPending} className={buttonClass.secondary}>Cancel</button>
          {problems.length > 0 && records.length > problems.length && (
            <button type="button" onClick={() => importIt.mutate(true)} disabled={importIt.isPending} className={buttonClass.secondary}>
              Add the other {records.length - problems.length}
            </button>
          )}
          <button type="button" onClick={() => { setProblem(''); setProblems([]); importIt.mutate(false); }} disabled={importIt.isPending || records.length === 0} className={buttonClass.primary}>
            {importIt.isPending ? 'Importing' : records.length ? `Import ${records.length} ${records.length === 1 ? 'row' : 'rows'}` : 'Import'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Spreadsheet file" hint="CSV, up to 5 MB and 2,000 rows">
          <input type="file" name="records" accept=".csv,text/csv" onChange={(e) => readFile(e.target.files?.[0])} />
        </Field>
        {rows && (
          <fieldset className="space-y-2 border-t border-feint pt-3">
            <legend className="text-[13px] font-semibold text-ink-900">Which column holds what</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {spec.fields.map((field) => (
                <Field key={field.key} label={`${field.label}${field.required ? '' : ''}`} hint={field.required ? 'Required' : undefined}>
                  <select
                    aria-label={`Column for ${field.label}`}
                    value={mapping[field.key] === undefined ? '' : String(mapping[field.key])}
                    onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  >
                    <option value="">{field.required ? 'Choose a column' : 'Not in the file'}</option>
                    {header.map((name, index) => <option key={index} value={index}>{name || `Column ${index + 1}`}</option>)}
                  </select>
                </Field>
              ))}
            </div>
            <p className="text-[12.5px] text-graphite-600">
              {records.length} {records.length === 1 ? 'row' : 'rows'} to import
              {records.length > 0 && mapping[nameKey] !== undefined ? `, starting with ${records.slice(0, 3).map((r) => String(r.values[nameKey] ?? '(no name)')).join(', ')}` : ''}.
            </p>
          </fieldset>
        )}
        {problems.length > 0 && (
          <section aria-labelledby="import-problems" className="space-y-1">
            <h3 id="import-problems" className="text-[13.5px] font-semibold text-ledger-red">Rows to fix</h3>
            <ul className="max-h-48 overflow-y-auto border-t border-feint text-[13px]">
              {problems.slice(0, 100).map((p) => (
                <li key={p.row} className="border-b border-feint py-1"><span className="tabular-currency text-graphite-600">Row {p.row}</span> · {p.reason}</li>
              ))}
            </ul>
            {problems.length > 100 && <p className="text-[12.5px] text-graphite-600">and {problems.length - 100} more.</p>}
          </section>
        )}
      </div>
    </Dialog>
  );
}
