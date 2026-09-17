import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Check, Copy } from 'lucide-react';
import { useAppStore } from '../../store';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { Dialog } from '../ledger/Dialog';
import { RunningLedger, LedgerLine } from '../ledger/RunningLedger';
import { buttonClass } from '../ledger/Page';

export type DrillDownEntityType = 'ITEM' | 'VENDOR' | 'CUSTOMER' | 'EMPLOYEE' | 'ACCOUNT' | 'INVOICE' | 'BILL';

export interface EntityDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: DrillDownEntityType;
  entityId: string | null;
  initialData?: any;
  onEdit?: (entity: any) => void;
}

const ENDPOINT: Record<DrillDownEntityType, { path: string; key: string }> = {
  ITEM: { path: '/api/inventory', key: 'items' },
  VENDOR: { path: '/api/vendors', key: 'vendors' },
  CUSTOMER: { path: '/api/customers', key: 'customers' },
  EMPLOYEE: { path: '/api/employees', key: 'employees' },
  ACCOUNT: { path: '/api/accounts', key: 'accounts' },
  BILL: { path: '/api/bills', key: 'bills' },
  INVOICE: { path: '/api/invoices', key: 'invoices' },
};

const NOUN: Record<DrillDownEntityType, string> = {
  ITEM: 'Stock item',
  VENDOR: 'Vendor',
  CUSTOMER: 'Customer',
  EMPLOYEE: 'Employee',
  ACCOUNT: 'Account',
  BILL: 'Bill',
  INVOICE: 'Invoice',
};

type Value = React.ReactNode | string | number | null | undefined;
const blank = (v: Value) => v === null || v === undefined || v === '';
const titleCase = (s?: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '');
const dateText = (d?: string) => {
  if (!d) return undefined;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? d : format(parsed, 'dd/MM/yyyy');
};

/** A labelled line in the record. Missing values say so rather than inventing one. */
function Line({ label, value, figure = false, copy }: { label: string; value: Value; figure?: boolean; copy?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-feint py-2">
      <dt className="text-[13px] text-graphite-600">{label}</dt>
      <dd className={`flex items-baseline gap-1.5 text-right text-[13.5px] ${blank(value) ? 'text-graphite-500' : 'text-ink-900'} ${figure ? 'll-figure' : ''}`}>
        {blank(value) ? 'Not recorded' : value}
        {copy && !blank(value) && copy}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="ll-printed border-b border-ink-900 pb-1 text-[11px] text-graphite-600">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}

export function EntityDrillDownModal({ isOpen, onClose, entityType, entityId, initialData, onEdit }: EntityDrillDownModalProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'transactions'>('details');
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const { currentOrgId, activeCompany } = useAppStore();
  const currency = activeCompany?.baseCurrency || 'KES';

  const { data: entityData } = useQuery({
    queryKey: ['drilldown', entityType, entityId, currentOrgId],
    queryFn: async () => {
      if (!entityId) return initialData || null;
      const { path, key } = ENDPOINT[entityType];
      const res = await fetch(path, { headers: { 'x-org-id': currentOrgId } });
      if (!res.ok) return initialData || null;
      const json = await res.json();
      return (json[key] || []).find((row: any) => row.id === entityId) || initialData;
    },
    enabled: isOpen && !!entityId,
    initialData,
  });

  const hasTransactions = entityType === 'CUSTOMER' || entityType === 'VENDOR' || entityType === 'ACCOUNT';

  const { data: transactionsData, isLoading: transactionsLoading } = useQuery({
    queryKey: ['drilldown-transactions', entityType, entityId, currentOrgId],
    queryFn: async () => {
      if (!entityId) return [];
      if (entityType === 'CUSTOMER') {
        const res = await fetch('/api/invoices', { headers: { 'x-org-id': currentOrgId } });
        if (!res.ok) throw new Error('Failed to fetch invoices');
        return ((await res.json()).invoices || []).filter((inv: any) => inv.customerId === entityId);
      }
      if (entityType === 'VENDOR') {
        const res = await fetch('/api/bills', { headers: { 'x-org-id': currentOrgId } });
        if (!res.ok) throw new Error('Failed to fetch bills');
        return ((await res.json()).bills || []).filter((b: any) => b.vendorId === entityId);
      }
      if (entityType === 'ACCOUNT') {
        const res = await fetch('/api/journal-entries', { headers: { 'x-org-id': currentOrgId } });
        if (!res.ok) throw new Error('Failed to fetch journal entries');
        return ((await res.json()).entries || []).filter((entry: any) => entry.lines?.some((l: any) => l.accountId === entityId));
      }
      return [];
    },
    enabled: isOpen && !!entityId && hasTransactions,
  });

  React.useEffect(() => {
    if (isOpen) setActiveTab('details');
  }, [isOpen, entityId]);

  if (!isOpen) return null;

  const raw = entityData || initialData || {};
  const data =
    entityType === 'ITEM'
      ? { ...raw, priceCents: raw.unitPriceCents ?? raw.priceCents, costCents: raw.costPriceCents ?? raw.costCents }
      : raw;
  const transactions: any[] = transactionsData || [];

  const copyButton = (text: string, field: string) => (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
      }}
      aria-label={copiedField === field ? 'Copied' : `Copy ${field}`}
      className="self-center p-0.5 text-graphite-600 hover:text-ink-900"
    >
      {copiedField === field ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  );

  const money = (cents?: number) => (cents === undefined || cents === null ? undefined : <Amount cents={cents} currency={currency} tone="ink" />);

  const accountBalance = () => {
    const cents = Number(data.balanceCents || 0);
    if (Math.round(cents) === 0) return <Amount cents={0} currency={currency} tone="ink" />;
    const normalDebit = ['ASSET', 'EXPENSE', 'COGS'].includes(data.type);
    const side = (normalDebit ? cents > 0 : cents < 0) ? 'Dr' : 'Cr';
    return (
      <span className="inline-flex items-baseline gap-1.5">
        <Amount cents={Math.abs(cents)} currency={currency} tone="ink" />
        <span className="text-[11.5px] text-graphite-600">{side}</span>
      </span>
    );
  };

  const title = (() => {
    switch (entityType) {
      case 'ITEM':
        return data.name || 'Stock item';
      case 'VENDOR':
      case 'CUSTOMER':
        return data.displayName || data.name || NOUN[entityType];
      case 'EMPLOYEE':
        return `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Employee';
      case 'ACCOUNT':
        return data.code ? `${data.code} ${data.name}` : data.name || 'Account';
      case 'INVOICE':
        return data.invoiceNo || data.invoiceNumber || 'Invoice';
      case 'BILL':
        return data.billNumber || 'Bill';
    }
  })();

  const standing = (status?: string, dueDate?: string) => {
    if (status === 'PAID') return <Mark kind="tick" label="Paid" />;
    if (status === 'VOID') return <span className="text-[12px] text-graphite-600">Void</span>;
    if (dueDate && new Date(dueDate) < new Date()) return <Mark kind="circled" label="Overdue" />;
    return <Mark kind="query" label={dueDate ? `Due ${dateText(dueDate)}` : titleCase(status) || 'Open'} />;
  };

  const figures: { label: string; value: React.ReactNode }[] = (() => {
    switch (entityType) {
      case 'ITEM': {
        const profit = (data.priceCents || 0) - (data.costCents || 0);
        const margin = data.priceCents ? `${((profit / data.priceCents) * 100).toFixed(1)}%` : '–';
        return [
          { label: 'Selling price', value: money(data.priceCents || 0) },
          { label: 'Cost', value: money(data.costCents || 0) },
          { label: 'Gross margin', value: <span className="ll-figure">{margin}</span> },
          { label: 'Stock at cost', value: money((data.quantityOnHand || 0) * (data.costCents || 0)) },
        ];
      }
      case 'EMPLOYEE': {
        const allowances = (data.housingAllowanceCents || 0) + (data.transportAllowanceCents || 0);
        return [
          { label: 'Basic salary', value: money(data.baseSalaryCents || 0) },
          { label: 'Allowances', value: money(allowances) },
          { label: 'Gross pay', value: money((data.baseSalaryCents || 0) + allowances) },
        ];
      }
      case 'ACCOUNT':
        return [
          { label: 'Balance', value: accountBalance() },
          { label: 'Type', value: titleCase(data.type) },
          { label: 'Entries', value: <span className="ll-figure">{transactionsLoading ? '–' : transactions.length}</span> },
        ];
      case 'CUSTOMER':
      case 'VENDOR': {
        const open = transactions.filter((t) => t.status !== 'PAID' && t.status !== 'VOID');
        const owed = open.reduce((s, t) => s + (t.amountDueCents ?? t.totalCents ?? 0), 0);
        return [
          { label: entityType === 'CUSTOMER' ? 'Owes you' : 'You owe', value: transactionsLoading ? '–' : money(owed) },
          { label: entityType === 'CUSTOMER' ? 'Invoices' : 'Bills', value: <span className="ll-figure">{transactionsLoading ? '–' : transactions.length}</span> },
          { label: 'Terms', value: data.paymentTerms || '–' },
        ];
      }
      case 'INVOICE':
      case 'BILL':
        return [
          { label: 'Total', value: money(data.totalCents || 0) },
          { label: 'Still owed', value: money(data.amountDueCents ?? data.totalCents ?? 0) },
          { label: 'Standing', value: standing(data.status, data.dueDate) },
        ];
    }
  })();

  const details = (() => {
    switch (entityType) {
      case 'ITEM':
        return (
          <>
            <Section title="Stock">
              <Line label="On hand" value={data.quantityOnHand !== undefined ? `${data.quantityOnHand} ${data.unitOfMeasure || 'units'}` : undefined} figure />
              <Line label="Reorder point" value={data.reorderPoint} figure />
              <Line label="Target level" value={data.targetStock} figure />
              <Line label="Location" value={data.location} />
            </Section>
            <Section title="Identifiers">
              <Line label="SKU" value={data.sku} figure copy={data.sku ? copyButton(data.sku, 'SKU') : undefined} />
              <Line label="Barcode" value={data.barcode} figure />
              <Line label="Kind" value={data.itemType} />
              <Line label="VAT rate" value={data.taxRate !== undefined ? `${data.taxRate}%` : undefined} />
            </Section>
            {data.description && (
              <div className="md:col-span-2">
                <h3 className="ll-printed border-b border-ink-900 pb-1 text-[11px] text-graphite-600">Description</h3>
                <p className="py-2 text-[13.5px] leading-relaxed text-ink-900">{data.description}</p>
              </div>
            )}
          </>
        );
      case 'VENDOR':
      case 'CUSTOMER':
        return (
          <>
            <Section title="Contact">
              <Line label="Registered name" value={data.legalName} />
              <Line label="Contact person" value={data.contactPerson} />
              <Line label="Email" value={data.email} />
              <Line label="Phone" value={data.phone} figure />
              <Line label="Address" value={[data.address || data.billingAddress, data.city, data.postalCode, data.country].filter(Boolean).join(', ')} />
            </Section>
            <Section title={entityType === 'VENDOR' ? 'Tax and payment' : 'Tax and credit'}>
              <Line label="KRA PIN" value={data.kraPin} figure copy={data.kraPin ? copyButton(data.kraPin, 'KRA PIN') : undefined} />
              <Line label="Currency" value={data.currency} />
              <Line label="Payment terms" value={data.paymentTerms} />
              {entityType === 'CUSTOMER' ? (
                <>
                  <Line label="Credit limit" value={data.creditLimitCents ? money(data.creditLimitCents) : undefined} />
                  <Line label="Discount" value={data.discountPercent ? `${data.discountPercent}%` : undefined} />
                </>
              ) : (
                <>
                  <Line label="Bank" value={[data.bankName, data.bankBranch].filter(Boolean).join(', ')} />
                  <Line label="Bank account" value={data.bankAccountNo} figure />
                  <Line label="M-Pesa till or paybill" value={data.mpesaNumber} figure />
                </>
              )}
            </Section>
          </>
        );
      case 'EMPLOYEE':
        return (
          <>
            <Section title="Employment">
              <Line label="Job title" value={data.jobTitle} />
              <Line label="Department" value={data.department} />
              <Line label="Employment" value={data.employmentType} />
              <Line label="Started" value={dateText(data.hireDate)} figure />
              <Line label="National ID" value={data.nationalId} figure />
            </Section>
            <Section title="Statutory numbers">
              <Line label="KRA PIN" value={data.kraPin} figure />
              <Line label="NSSF number" value={data.nssfNumber} figure />
              <Line label="SHIF number" value={data.shifNumber} figure />
              <Line label="Bank" value={data.bankName} />
            </Section>
          </>
        );
      case 'ACCOUNT':
        return (
          <>
            <Section title="Account">
              <Line label="Code" value={data.code} figure />
              <Line label="Type" value={titleCase(data.type)} />
              <Line label="Subtype" value={data.subtype} />
            </Section>
            <Section title="Notes">
              <Line label="Description" value={data.description} />
            </Section>
          </>
        );
      case 'INVOICE':
      case 'BILL':
        return (
          <>
            <Section title="Dates">
              <Line label="Issued" value={dateText(data.issueDate || data.billDate || data.date)} figure />
              <Line label="Due" value={dateText(data.dueDate)} figure />
            </Section>
            <Section title="Amounts">
              <Line label="Subtotal" value={money(data.subtotalCents)} />
              <Line label="VAT" value={money(data.taxCents)} />
              <Line label="Total" value={money(data.totalCents)} />
              {data.currency && data.currency !== currency && <Line label={`In ${data.currency}`} value={data.foreignAmountCents ? <Amount cents={data.foreignAmountCents} currency={data.currency} tone="ink" /> : undefined} />}
            </Section>
          </>
        );
    }
  })();

  const accountLines: LedgerLine[] =
    entityType === 'ACCOUNT'
      ? transactions.flatMap((entry: any) =>
          (entry.lines || [])
            .filter((l: any) => l.accountId === entityId)
            .map((l: any, i: number) => ({ id: `${entry.id}-${i}`, date: entry.entryDate, sourceType: entry.sourceType, memo: l.description || entry.memo, debit: Number(l.debit || 0), credit: Number(l.credit || 0) })),
        )
      : [];

  const documentsTotal = transactions.reduce((s, t) => s + (t.totalCents || 0), 0);

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      width="xl"
      title={title}
      note={NOUN[entityType]}
      footer={
        <>
          {onEdit && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onEdit(data);
              }}
              className={buttonClass.secondary}
            >
              Edit
            </button>
          )}
          <button type="button" onClick={onClose} className={buttonClass.secondary}>
            Close
          </button>
        </>
      }
    >
      <dl className="-mx-5 -mt-4 mb-4 grid grid-cols-2 border-b border-feint-strong sm:grid-flow-col sm:auto-cols-fr sm:grid-cols-none">
        {figures.map((f, i) => (
          <div key={f.label} className={`px-5 py-3 ${i > 0 ? 'sm:border-l' : ''} ${i % 2 === 1 ? 'border-l sm:border-l' : ''} ${i >= 2 ? 'border-t sm:border-t-0' : ''} border-feint`}>
            <dt className="ll-printed text-[10.5px] text-graphite-600">{f.label}</dt>
            <dd className="mt-1 text-[15px] text-ink-900">{f.value}</dd>
          </div>
        ))}
      </dl>

      {hasTransactions && (
        <div className="mb-4 flex gap-5 border-b border-feint text-[13px]" role="tablist" aria-label="Record sections">
          {[
            { id: 'details' as const, name: 'Details' },
            { id: 'transactions' as const, name: entityType === 'ACCOUNT' ? 'Ledger' : entityType === 'CUSTOMER' ? 'Invoices' : 'Bills' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`-mb-px border-b-2 py-2 ${activeTab === t.id ? 'border-oxblood font-semibold text-ink-900' : 'border-transparent text-graphite-600 hover:text-ink-900'}`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'details' || !hasTransactions ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">{details}</div>
      ) : transactionsLoading ? (
        <p className="py-6 text-[13.5px] text-graphite-600" role="status">
          Loading
        </p>
      ) : entityType === 'ACCOUNT' ? (
        accountLines.length === 0 ? (
          <p className="py-6 text-[13.5px] text-graphite-600">Nothing is posted to this account yet.</p>
        ) : (
          <RunningLedger lines={accountLines} currency={currency} accountLabel={title} />
        )
      ) : transactions.length === 0 ? (
        <p className="py-6 text-[13.5px] text-graphite-600">No {entityType === 'CUSTOMER' ? 'invoices' : 'bills'} yet.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[30rem] text-[13.5px]">
            <caption className="sr-only">{entityType === 'CUSTOMER' ? 'Invoices' : 'Bills'} for {title}</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-4 text-left">Date</th>
                <th scope="col" className="pr-4 text-left">Number</th>
                <th scope="col" className="pr-4 text-left">Standing</th>
                <th scope="col" className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="pr-4 whitespace-nowrap text-graphite-600">{dateText(t.issueDate || t.billDate || t.date) || '–'}</td>
                  <td className="pr-4 ll-figure text-ink-900">{t.invoiceNo || t.invoiceNumber || t.billNumber || '–'}</td>
                  <td className="pr-4 whitespace-nowrap">{standing(t.status, t.dueDate)}</td>
                  <td className="text-right whitespace-nowrap"><Amount cents={t.totalCents || 0} currency={currency} tone="ink" /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={3} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">
                  Total of {transactions.length}
                </th>
                <td className="ll-total py-2 text-right whitespace-nowrap font-semibold"><Amount cents={documentsTotal} currency={currency} tone="ink" /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Dialog>
  );
}
