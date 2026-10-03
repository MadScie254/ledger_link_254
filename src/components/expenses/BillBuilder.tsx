import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useAppStore } from '../../store';
import { SUPPORTED_CURRENCIES } from '../../utils/currency';
import { apiRequest, newIdempotencyKey } from '../../utils/apiRequest';
import { addDaysIso, todayIn } from '../../utils/dates';
import { centsFromAmountText } from '../../utils/salesOrders';
import { Amount } from '../ledger/Amount';
import { Dialog, Field } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import { PostedStamp } from '../ledger/PostedStamp';

interface Line {
  key: number;
  itemId: string;
  description: string;
  accountId: string;
  quantity: string;
  amount: string;
  taxRate: string;
}

const isStocked = (item: any) => item && !String(item.type || '').toLowerCase().includes('service');
const emptyLine = (key: number, accountId = ''): Line => ({ key, itemId: '', description: '', accountId, quantity: '', amount: '', taxRate: '16' });

/**
 * A supplier's bill as it arrived: who it is from, its dates and the
 * supplier's own number, then a line for each thing bought. A line can be a
 * stock item and the quantity received, which the bill counts in. Saving
 * posts the expenses, the recoverable VAT and the amount owed in one entry.
 */
export function BillBuilder({ open, onClose, scanned }: {
  open: boolean;
  onClose: () => void;
  /** What the receipt reader found, for the person to check. */
  scanned?: { vendor: string; amount: number; date: string } | null;
}) {
  const { currentOrgId, activeCompany, exchangeRates } = useAppStore();
  const queryClient = useQueryClient();
  const base = activeCompany?.baseCurrency || 'KES';
  const today = todayIn(activeCompany?.timeZone);

  const [vendorId, setVendorId] = useState('');
  const [billDate, setBillDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDaysIso(today, 30));
  const [supplierReference, setSupplierReference] = useState('');
  const [currency, setCurrency] = useState(base);
  const [rate, setRate] = useState('1');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(1)]);
  const [problem, setProblem] = useState('');
  const [posted, setPosted] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const vendors = useQuery({ queryKey: ['vendors', currentOrgId], queryFn: () => apiRequest('/api/vendors'), enabled: open });
  const accounts = useQuery({ queryKey: ['accounts', currentOrgId], queryFn: () => apiRequest('/api/accounts'), enabled: open });
  const inventory = useQuery({ queryKey: ['inventory', currentOrgId], queryFn: () => apiRequest('/api/inventory'), enabled: open });

  const vendorList: any[] = (vendors.data?.vendors || []).filter((v: any) => v.isActive !== false || v.id === vendorId);
  // What a bill line may post to: expenses, cost of sales, and assets other
  // than money, receivables and recoverable VAT (the database checks too).
  const lineAccounts: any[] = (accounts.data?.accounts || []).filter((a: any) =>
    a.isActive !== false && ['EXPENSE', 'COGS', 'ASSET'].includes(a.type) && !a.isBankAccount && !['1100', '1150'].includes(a.code));
  const items: any[] = (inventory.data?.items || []).filter((i: any) => i.status !== 'Inactive');
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const vendor = vendorList.find((v) => v.id === vendorId);
  const defaultAccountId = vendor?.defaultAccountId && lineAccounts.some((a) => a.id === vendor.defaultAccountId)
    ? vendor.defaultAccountId
    : lineAccounts.find((a) => a.type === 'EXPENSE')?.id || '';

  // A fresh bill each time the dialog opens, filled from a read receipt if there is one.
  useEffect(() => {
    if (!open) return;
    setPosted(false);
    setProblem('');
    setIdempotencyKey(newIdempotencyKey());
    setBillDate(scanned?.date && /^\d{4}-\d{2}-\d{2}$/.test(scanned.date) ? scanned.date : today);
    setDueDate(addDaysIso(today, 30));
    setSupplierReference('');
    setCurrency(base);
    setRate('1');
    setNotes('');
    const match = (vendors.data?.vendors || []).find((v: any) => v.displayName === scanned?.vendor);
    setVendorId(match?.id || '');
    setLines([{
      ...emptyLine(1),
      description: scanned?.vendor ? `Receipt from ${scanned.vendor}` : '',
      amount: scanned?.amount ? String(scanned.amount) : '',
      taxRate: scanned ? '0' : '16',
    }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lines without an account take the supplier's usual account once it is known.
  useEffect(() => {
    if (!defaultAccountId) return;
    setLines((prev) => prev.map((l) => (l.accountId ? l : { ...l, accountId: defaultAccountId })));
  }, [defaultAccountId]);

  const isForeign = currency !== base;
  const rateNum = parseFloat(rate) > 0 ? parseFloat(rate) : 1;
  const lineCents = (l: Line) => centsFromAmountText(l.amount) ?? 0;
  const baseNet = (l: Line) => (isForeign ? Math.round(lineCents(l) / rateNum) : lineCents(l));
  const baseTax = (l: Line) => Math.round(baseNet(l) * (Number(l.taxRate) || 0) / 100);
  const subtotalCents = lines.reduce((sum, l) => sum + lineCents(l), 0);
  const baseTaxCents = lines.reduce((sum, l) => sum + baseTax(l), 0);
  const shownTaxCents = isForeign ? Math.round(baseTaxCents * rateNum) : baseTaxCents;

  const setLine = (key: number, patch: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const chooseItem = (line: Line, itemId: string) => {
    const item = itemById.get(itemId);
    if (!item) return setLine(line.key, { itemId: '' });
    const quantity = line.quantity || '1';
    const costCents = Number(item.costPriceCents ?? item.costCents ?? 0);
    setLine(line.key, {
      itemId,
      description: line.description || item.name,
      accountId: item.cogsAccountId || line.accountId || defaultAccountId,
      quantity,
      amount: costCents > 0 ? ((costCents * Number(quantity)) / 100).toFixed(2) : line.amount,
      taxRate: item.taxRate != null ? String(item.taxRate) : line.taxRate,
    });
  };

  const post = useMutation({
    mutationFn: () => apiRequest<{ id: string }>('/api/bills', {
      body: {
        vendorId,
        billDate,
        dueDate,
        supplierReference: supplierReference.trim() || undefined,
        currency,
        exchangeRate: rateNum,
        notes: notes.trim() || undefined,
        idempotencyKey,
        lines: lines.filter((l) => lineCents(l) > 0).map((l) => ({
          description: l.description.trim(),
          accountId: l.accountId,
          amountCents: baseNet(l),
          ...(isForeign ? { foreignAmountCents: lineCents(l) } : {}),
          taxCents: baseTax(l),
          ...(l.itemId ? { inventoryItemId: l.itemId, quantity: Number(l.quantity) } : {}),
        })),
      },
      fallback: 'The bill could not be saved.',
    }),
    onSuccess: () => {
      for (const key of ['bills', 'accounts', 'vendors', 'inventory', 'dashboard-metrics', 'journal-entries']) {
        queryClient.invalidateQueries({ queryKey: [key, currentOrgId] });
      }
      setPosted(true);
      window.setTimeout(onClose, 520);
    },
    onError: (err: Error) => setProblem(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem('');
    const filled = lines.filter((l) => l.amount.trim() || l.description.trim() || l.itemId);
    if (filled.length === 0 || subtotalCents <= 0) return setProblem('Enter an amount on at least one line.');
    for (const [index, l] of filled.entries()) {
      if (centsFromAmountText(l.amount) === null || lineCents(l) <= 0) return setProblem(`Line ${index + 1}: enter the amount, such as 1,250.00.`);
      if (!l.description.trim()) return setProblem(`Line ${index + 1}: say what it was for.`);
      if (!l.accountId) return setProblem(`Line ${index + 1}: choose the account.`);
      if (l.itemId) {
        const quantity = Number(l.quantity);
        if (!(quantity > 0)) return setProblem(`Line ${index + 1}: enter the quantity received.`);
        if (isStocked(itemById.get(l.itemId)) && !Number.isInteger(quantity)) return setProblem(`Line ${index + 1}: stock is counted in whole units.`);
      }
    }
    if (dueDate < billDate) return setProblem('The due date cannot be before the bill date.');
    post.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!post.isPending) onClose(); }}
      width="xl"
      title={scanned ? 'Check the receipt' : 'New bill'}
      note={scanned ? 'Read from the photo. Correct anything misread before saving.' : 'Saving it posts the expenses and the amount owed to the supplier. Stock items on it are counted in.'}
      footer={
        <>
          {problem && <p role="alert" className="mr-auto text-[13px] text-ledger-red">{problem}</p>}
          <button type="button" onClick={onClose} disabled={post.isPending} className={buttonClass.secondary}>Cancel</button>
          <button type="submit" form="bill-builder" disabled={post.isPending || !vendorId} className={buttonClass.primary}>
            {post.isPending ? 'Saving' : 'Save bill'}
          </button>
        </>
      }
    >
      <div className="relative">
        {posted && <PostedStamp label="Bill posted" />}
        <form id="bill-builder" onSubmit={submit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Supplier" hint={scanned?.vendor && !vendorId ? `The receipt names ${scanned.vendor}. Add them as a vendor if they are new.` : undefined}>
              <select required name="vendorId" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Choose a vendor</option>
                {vendorList.map((v) => <option key={v.id} value={v.id}>{v.displayName}</option>)}
              </select>
            </Field>
            <Field label="Bill date">
              <input required type="date" name="billDate" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
            <Field label="Due">
              <input required type="date" name="dueDate" value={dueDate} min={billDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Supplier's invoice number" hint="Optional. The same number cannot be entered twice for one supplier.">
              <input name="supplierReference" maxLength={100} autoComplete="off" value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} />
            </Field>
            <Field label="Currency">
              <select value={currency} onChange={(e) => { setCurrency(e.target.value); setRate(e.target.value === base ? '1' : String(exchangeRates[e.target.value] || 1)); }}>
                {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
              </select>
            </Field>
            {isForeign && (
              <Field label={`${currency} per 1 ${base}`}>
                <input required type="number" min="0.00000001" step="any" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="text-right tabular-currency" />
              </Field>
            )}
          </div>

          <div role="group" aria-label={`Bill lines, amounts in ${currency}`}>
            <ol className="border-t border-feint-strong">
              {lines.map((l, i) => {
                const item = itemById.get(l.itemId);
                return (
                  <li key={l.key} className="relative grid grid-cols-2 gap-2 border-b border-feint py-3 pr-8 sm:grid-cols-12 sm:gap-3">
                    <label className="col-span-2 block sm:col-span-4">
                      <span className="mb-1 block text-[12.5px] text-graphite-600">Line {i + 1}, stock item</span>
                      <select aria-label={`Line ${i + 1} stock item`} value={l.itemId} onChange={(e) => chooseItem(l, e.target.value)} className="h-9 w-full border px-2 text-[13.5px]">
                        <option value="">No stock item</option>
                        {items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
                      </select>
                    </label>
                    <label className="col-span-2 block sm:col-span-8">
                      <span className="mb-1 block text-[12.5px] text-graphite-600">Particulars</span>
                      <input aria-label={`Line ${i + 1} particulars`} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} className="h-9 w-full border px-2.5 text-[13.5px]" />
                    </label>
                    <label className="col-span-2 block sm:col-span-5">
                      <span className="mb-1 block text-[12.5px] text-graphite-600">Account</span>
                      <select aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => setLine(l.key, { accountId: e.target.value })} className="h-9 w-full border px-2 text-[13.5px]">
                        <option value="">Choose an account</option>
                        {lineAccounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                      </select>
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[12.5px] text-graphite-600">Qty</span>
                      <input
                        aria-label={`Line ${i + 1} quantity`}
                        type="number" min="0" step={isStocked(item) ? '1' : 'any'} inputMode="decimal"
                        disabled={!l.itemId}
                        value={l.quantity}
                        onChange={(e) => {
                          const quantity = e.target.value;
                          const cost = Number(item?.costPriceCents ?? 0);
                          setLine(l.key, cost > 0 && Number(quantity) > 0 ? { quantity, amount: ((cost * Number(quantity)) / 100).toFixed(2) } : { quantity });
                        }}
                        className="h-9 w-full border px-2 text-right tabular-currency text-[13.5px] disabled:bg-paper-200"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-[12.5px] text-graphite-600">VAT %</span>
                      <input aria-label={`Line ${i + 1} VAT percentage`} type="number" min="0" max="100" step="0.01" inputMode="decimal" value={l.taxRate} onChange={(e) => setLine(l.key, { taxRate: e.target.value })} className="h-9 w-full border px-2 text-right tabular-currency text-[13.5px]" />
                    </label>
                    <label className="col-span-2 block sm:col-span-3">
                      <span className="mb-1 block text-[12.5px] text-graphite-600">Amount, {currency}</span>
                      <input aria-label={`Line ${i + 1} amount`} inputMode="decimal" value={l.amount} onChange={(e) => setLine(l.key, { amount: e.target.value })} className="h-9 w-full border px-2.5 text-right tabular-currency text-ink-blue text-[13.5px]" />
                    </label>
                    {lines.length > 1 && (
                      <button type="button" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`} className="absolute right-0 top-8 p-1 text-graphite-600 hover:text-oxblood">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
            <button type="button" onClick={() => setLines((prev) => [...prev, emptyLine(Math.max(...prev.map((x) => x.key)) + 1, defaultAccountId)])} className={`${buttonClass.quiet} mt-3`}>
              Add a line
            </button>
            <div className="ml-auto mt-3 max-w-sm">
              <div className="flex items-baseline justify-between border-b border-feint py-1.5 text-[13px] text-graphite-600">
                <span>Subtotal</span>
                <Amount cents={subtotalCents} currency={currency} size="xs" tone="ink" />
              </div>
              <div className="flex items-baseline justify-between border-b border-feint py-1.5 text-[13px] text-graphite-600">
                <span>Recoverable VAT</span>
                <Amount cents={shownTaxCents} currency={currency} size="xs" tone="ink" />
              </div>
              <div className="ll-total flex items-baseline justify-between py-2">
                <span className="font-semibold text-ink-900">Total owed</span>
                <span className="font-semibold" aria-live="polite"><Amount cents={subtotalCents + shownTaxCents} currency={currency} tone="ink" /></span>
              </div>
            </div>
          </div>

          <Field label="Notes" hint="Optional">
            <textarea rows={2} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} className="resize-none" />
          </Field>
        </form>
      </div>
    </Dialog>
  );
}
