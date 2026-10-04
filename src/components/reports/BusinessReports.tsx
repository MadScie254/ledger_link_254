import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '../../store';
import { apiRequest } from '../../utils/apiRequest';
import { downloadCsv } from '../../utils/exportCsv';
import { FinancialPDFEngine } from '../../utils/pdfExport';
import { todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Field } from '../ledger/Dialog';
import { EmptyNote } from '../ledger/Page';
import { StatementPage, useStatementFigures } from '../ledger/Statement';

const PERIODS = ['This Month', 'This Quarter', 'This Year-to-date', 'Last Year'];
const shortDate = (value: string | null | undefined) => (value ? format(parseISO(value), 'dd/MM/yyyy') : '');
const longDate = (value: string) => format(parseISO(value), 'd MMMM yyyy');
const rangeText = (range?: { start: string; end: string }) => (range ? `${longDate(range.start)} to ${longDate(range.end)}` : '');
const kes = (cents: number) => FinancialPDFEngine.formatKES(cents);

function PeriodSelect({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="sr-only">Period</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-9 px-2.5 text-[13.5px] border border-field rounded-sm bg-paper-100 text-ink-900">
        {PERIODS.map((period) => <option key={period}>{period}</option>)}
      </select>
    </label>
  );
}

interface Column<Row> { label: string; cents?: (row: Row) => number; text?: (row: Row) => string; total?: boolean }

/** A ranked table of names with amount columns and a total foot, for the sales and spending reports. */
function RankedReport<Row extends { name: string }>({
  onBack, title, endpoint, queryKey, columns, nameLabel, empty, totalLabel, totalOf,
}: {
  onBack: () => void; title: string; endpoint: string; queryKey: string; columns: Column<Row>[];
  nameLabel: string; empty: string; totalLabel: string; totalOf: (data: any) => number;
}) {
  const { currentOrgId, activeCompany } = useAppStore();
  const { currency, shown } = useStatementFigures();
  const [dateRange, setDateRange] = useState('This Year-to-date');
  const report = useQuery({
    queryKey: [queryKey, currentOrgId, dateRange],
    queryFn: () => apiRequest<any>(`${endpoint}?dateRange=${encodeURIComponent(dateRange)}`, { fallback: `Failed to fetch ${title.toLowerCase()}` }),
  });
  const rows: Row[] = report.data?.rows || [];
  const headers = [nameLabel, ...columns.map((c) => c.label)];
  const cell = (row: Row, column: Column<Row>) => (column.cents ? column.cents(row) : column.text!(row));

  return (
    <StatementPage
      title={title}
      period={report.data ? rangeText(report.data.range) : dateRange}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: title.toLowerCase(), path: endpoint, onRetry: () => report.refetch() } : null}
      controls={<PeriodSelect value={dateRange} onChange={setDateRange} />}
      onCsv={() => downloadCsv(`${queryKey}.csv`, [
        headers,
        ...rows.map((row) => [row.name, ...columns.map((c) => (c.cents ? c.cents(row) / 100 : c.text!(row)))]),
      ])}
      onPdf={() => FinancialPDFEngine.exportFinancialStatement(
        { title, period: rangeText(report.data?.range), companyName: activeCompany?.legalName || activeCompany?.name, kraPin: activeCompany?.taxId, currency: 'KES', filename: `${queryKey}.pdf` },
        [{
          headers,
          rows: [
            ...rows.map((row) => [row.name, ...columns.map((c) => (c.cents ? kes(c.cents(row)) : c.text!(row)))]),
            [totalLabel, ...columns.map((c) => (c.total ? kes(totalOf(report.data)) : ''))],
          ],
        }],
      )}
    >
      {rows.length === 0 ? (
        <EmptyNote>{empty}</EmptyNote>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[13.5px]">
            <caption className="sr-only">{title}, {rangeText(report.data?.range)}, figures in {currency} before VAT</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-4 text-left">{nameLabel}</th>
                {columns.map((c) => <th key={c.label} scope="col" className="pl-4 text-right">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.name}-${index}`}>
                  <td className="pr-4 text-ink-900">{row.name}</td>
                  {columns.map((c) => (
                    <td key={c.label} className="pl-4 text-right whitespace-nowrap">
                      {c.cents ? <Amount cents={shown(cell(row, c) as number)} currency={currency} tone={c.total ? 'ink' : 'figure'} /> : <span className="tabular-currency text-graphite-600">{cell(row, c)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">{totalLabel}</th>
                {columns.map((c) => (
                  <td key={c.label} className="ll-total py-2 pl-4 text-right whitespace-nowrap font-semibold">
                    {c.total ? <Amount cents={shown(totalOf(report.data))} currency={currency} tone="ink" /> : null}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[12.5px] text-graphite-600">Figures before VAT. Void documents are left out.</p>
        </div>
      )}
    </StatementPage>
  );
}

export function SalesByCustomerView({ onBack }: { onBack: () => void }) {
  return (
    <RankedReport<{ name: string; invoicedCents: number; cashSalesCents: number; creditedCents: number; netCents: number }>
      onBack={onBack}
      title="Sales by customer"
      endpoint="/api/reports/sales-by-customer"
      queryKey="reports_sales_by_customer"
      nameLabel="Customer"
      totalLabel="Total sales"
      totalOf={(data) => data?.totalCents || 0}
      empty="No sales in this period. Invoices, sales receipts and credit notes are added up here by customer."
      columns={[
        { label: 'Invoiced', cents: (r) => r.invoicedCents },
        { label: 'Paid on the spot', cents: (r) => r.cashSalesCents },
        { label: 'Credited', cents: (r) => -r.creditedCents },
        { label: 'Net sales', cents: (r) => r.netCents, total: true },
      ]}
    />
  );
}

export function SalesByItemView({ onBack }: { onBack: () => void }) {
  return (
    <RankedReport<{ name: string; quantity: number; amountCents: number }>
      onBack={onBack}
      title="Sales by item"
      endpoint="/api/reports/sales-by-item"
      queryKey="reports_sales_by_item"
      nameLabel="Item"
      totalLabel="Total sales"
      totalOf={(data) => data?.totalCents || 0}
      empty="No sales in this period. Lines on invoices, sales receipts and credit notes are added up here by stock item."
      columns={[
        { label: 'Quantity', text: (r) => String(Number(r.quantity.toFixed(3))) },
        { label: 'Sales', cents: (r) => r.amountCents, total: true },
      ]}
    />
  );
}

export function ExpensesBySupplierView({ onBack }: { onBack: () => void }) {
  return (
    <RankedReport<{ name: string; billedCents: number; paidNowCents: number; creditedCents: number; netCents: number }>
      onBack={onBack}
      title="Spending by supplier"
      endpoint="/api/reports/expenses-by-supplier"
      queryKey="reports_expenses_by_supplier"
      nameLabel="Supplier"
      totalLabel="Total spending"
      totalOf={(data) => data?.totalCents || 0}
      empty="No bills or expenses in this period. They are added up here by supplier, less supplier credits."
      columns={[
        { label: 'Billed', cents: (r) => r.billedCents },
        { label: 'Paid on the spot', cents: (r) => r.paidNowCents },
        { label: 'Credited', cents: (r) => -r.creditedCents },
        { label: 'Net spending', cents: (r) => r.netCents, total: true },
      ]}
    />
  );
}

/** Profit and loss with a column for each month of the period. */
export function MonthlyProfitAndLossView({ onBack }: { onBack: () => void }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const { currency, shown } = useStatementFigures();
  const [dateRange, setDateRange] = useState('This Year-to-date');
  const report = useQuery({
    queryKey: ['reports_pnl_monthly', currentOrgId, dateRange],
    queryFn: () => apiRequest<any>(`/api/reports/pnl-monthly?dateRange=${encodeURIComponent(dateRange)}`, { fallback: 'Failed to fetch the monthly profit and loss' }),
  });
  const data = report.data;
  const months: string[] = data?.months || [];
  const monthLabel = (month: string) => format(parseISO(`${month}-01`), 'MMM yyyy');
  const sections = data ? [
    { title: 'Income', section: data.income },
    { title: 'Cost of sales', section: data.costOfSales },
    { title: 'Expenses', section: data.expenses },
  ] : [];
  const isEmpty = data && sections.every((s) => s.section.rows.length === 0);
  const csvRows = data ? [
    ['Account', ...months.map(monthLabel), 'Total'],
    ...sections.flatMap(({ title, section }) => [
      [title],
      ...section.rows.map((r: any) => [`${r.code} ${r.name}`, ...r.months.map((m: number) => m / 100), r.totalCents / 100]),
      [`Total ${title.toLowerCase()}`, ...section.months.map((m: number) => m / 100), section.totalCents / 100],
    ]),
    ['Net profit', ...data.netMonths.map((m: number) => m / 100), data.netTotalCents / 100],
  ] : [];

  const figureRow = (label: string, values: number[], total: number, strong = false, key?: string) => (
    <tr key={key || label} className={strong ? 'font-semibold' : undefined}>
      <th scope="row" className={`pr-4 text-left ${strong ? 'll-total text-ink-900' : 'font-normal text-ink-900'}`}>{label}</th>
      {values.map((value, i) => (
        <td key={months[i]} className={`pl-3 text-right whitespace-nowrap ${strong ? 'll-total' : ''}`}><Amount cents={shown(value)} currency={currency} size="xs" tone={strong ? 'ink' : 'figure'} /></td>
      ))}
      <td className={`pl-3 text-right whitespace-nowrap ${strong ? 'll-total' : ''}`}><Amount cents={shown(total)} currency={currency} size="xs" tone="ink" /></td>
    </tr>
  );

  return (
    <StatementPage
      title="Profit and loss by month"
      period={data ? rangeText(data.range) : dateRange}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: 'the monthly profit and loss', path: '/api/reports/pnl-monthly', onRetry: () => report.refetch() } : null}
      controls={<PeriodSelect value={dateRange} onChange={setDateRange} />}
      onCsv={() => downloadCsv('profit_and_loss_by_month.csv', csvRows)}
      onPdf={() => FinancialPDFEngine.exportFinancialStatement(
        { title: 'Profit and loss by month', period: rangeText(data?.range), companyName: activeCompany?.legalName || activeCompany?.name, kraPin: activeCompany?.taxId, currency: 'KES', filename: 'profit_and_loss_by_month.pdf' },
        [{ headers: csvRows[0] as string[], rows: csvRows.slice(1).map((row) => row.map((value) => (typeof value === 'number' ? kes(Math.round(value * 100)) : value))) }],
      )}
    >
      {isEmpty ? (
        <EmptyNote>Nothing is posted to income, cost of sales or expense accounts in this period.</EmptyNote>
      ) : data ? (
        <div className="relative overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: `${16 + months.length * 7}rem` }}>
            <caption className="sr-only">Profit and loss by month, {rangeText(data.range)}, figures in {currency}</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-4 text-left">Account</th>
                {months.map((m) => <th key={m} scope="col" className="pl-3 text-right whitespace-nowrap">{monthLabel(m)}</th>)}
                <th scope="col" className="pl-3 text-right">Total</th>
              </tr>
            </thead>
            {sections.map(({ title, section }) => (
              <tbody key={title}>
                <tr><th colSpan={months.length + 2} scope="colgroup" className="pt-4 pb-1 text-left text-[12px] font-semibold uppercase tracking-wide text-graphite-600">{title}</th></tr>
                {section.rows.map((r: any) => figureRow(`${r.code} ${r.name}`, r.months, r.totalCents, false, r.accountId))}
                {figureRow(`Total ${title.toLowerCase()}`, section.months, section.totalCents, true)}
              </tbody>
            ))}
            <tfoot>
              {figureRow('Net profit', data.netMonths, data.netTotalCents, true)}
            </tfoot>
          </table>
        </div>
      ) : null}
    </StatementPage>
  );
}

/**
 * A customer's or supplier's statement for a period, from the ledger: the
 * balance brought forward, every invoice, bill, payment, credit and refund,
 * and the balance carried forward, with what is still open. Exported as a
 * PDF to send.
 */
export function PartyStatementView({ onBack, partyType }: { onBack: () => void; partyType: 'CUSTOMER' | 'VENDOR' }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const { currency, shown } = useStatementFigures();
  const today = todayIn(activeCompany?.timeZone);
  const [partyId, setPartyId] = useState('');
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const isCustomer = partyType === 'CUSTOMER';
  const parties = useQuery({
    queryKey: [isCustomer ? 'customers' : 'vendors', currentOrgId],
    queryFn: () => apiRequest<any>(isCustomer ? '/api/customers' : '/api/vendors'),
  });
  const list: any[] = (parties.data?.customers || parties.data?.vendors || []) as any[];
  const chosenId = partyId || list[0]?.id || '';
  const report = useQuery({
    queryKey: ['reports_statement', currentOrgId, partyType, chosenId, from, to],
    queryFn: () => apiRequest<any>(`/api/reports/statement?partyType=${partyType}&partyId=${chosenId}&from=${from}&to=${to}`, { fallback: 'Failed to fetch the statement' }),
    enabled: Boolean(chosenId && from && to && from <= to),
  });
  const data = report.data;
  const title = isCustomer ? 'Customer statement' : 'Supplier statement';
  const period = data ? `${longDate(data.from)} to ${longDate(data.to)}` : '';
  const headers = ['Date', 'Particulars', 'Reference', isCustomer ? 'Charged' : 'Billed', isCustomer ? 'Paid or credited' : 'Paid or credited', 'Balance'];

  const exportPdf = () => data && FinancialPDFEngine.exportFinancialStatement(
    {
      title: `${title}: ${data.party.name}`,
      subtitle: [data.party.kraPin ? `PIN ${data.party.kraPin}` : '', data.party.email || ''].filter(Boolean).join(' · '),
      period,
      companyName: activeCompany?.legalName || activeCompany?.name,
      kraPin: activeCompany?.taxId,
      currency: 'KES',
      filename: `statement_${data.party.name.replace(/[^A-Za-z0-9]+/g, '_')}_${data.to}.pdf`,
    },
    [
      {
        headers,
        rows: [
          [shortDate(data.from), 'Balance brought forward', '', '', '', kes(data.openingBalanceCents)],
          ...data.lines.map((l: any) => [shortDate(l.date), `${l.kind}${l.particulars ? `: ${l.particulars}` : ''}`, l.reference || '', l.chargeCents ? kes(l.chargeCents) : '', l.creditCents ? kes(l.creditCents) : '', kes(l.balanceCents)]),
          [shortDate(data.to), isCustomer ? 'Balance due' : 'Balance owed', '', '', '', kes(data.closingBalanceCents)],
        ],
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right', fontStyle: 'bold' } },
      },
      ...(data.openDocuments.length ? [{
        title: isCustomer ? 'Invoices still open' : 'Bills still open',
        headers: ['Number', 'Date', 'Due', 'Total', 'Still due'],
        rows: data.openDocuments.map((d: any) => [d.number, shortDate(d.date), shortDate(d.dueDate), kes(d.totalCents), kes(d.amountDueCents)]),
        columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
      }] : []),
    ],
  );

  return (
    <StatementPage
      title={title}
      period={period || 'Choose a period'}
      onBack={onBack}
      loading={report.isLoading && Boolean(chosenId)}
      problem={report.isError ? { what: 'the statement', path: '/api/reports/statement', onRetry: () => report.refetch() } : null}
      controls={
        <div className="flex flex-wrap items-end gap-3">
          <Field label={isCustomer ? 'Customer' : 'Supplier'}>
            <select name="statementParty" value={chosenId} onChange={(e) => setPartyId(e.target.value)}>
              {list.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
            </select>
          </Field>
          <Field label="From">
            <input type="date" name="statementFrom" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" name="statementTo" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      }
      onCsv={data ? () => downloadCsv(`statement_${data.to}.csv`, [
        headers,
        [data.from, 'Balance brought forward', '', '', '', data.openingBalanceCents / 100],
        ...data.lines.map((l: any) => [l.date, `${l.kind}${l.particulars ? `: ${l.particulars}` : ''}`, l.reference || '', l.chargeCents / 100, l.creditCents / 100, l.balanceCents / 100]),
        [data.to, isCustomer ? 'Balance due' : 'Balance owed', '', '', '', data.closingBalanceCents / 100],
      ]) : undefined}
      onPdf={data ? exportPdf : undefined}
    >
      {list.length === 0 && !parties.isLoading ? (
        <EmptyNote>{isCustomer ? 'Add a customer first.' : 'Add a supplier first.'}</EmptyNote>
      ) : data ? (
        <div className="space-y-5">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[13.5px]">
              <caption className="sr-only">{title} for {data.party.name}, {period}, figures in {currency}</caption>
              <thead>
                <tr>
                  <th scope="col" className="pr-4 text-left">Date</th>
                  <th scope="col" className="pr-4 text-left">Particulars</th>
                  <th scope="col" className="pl-4 text-right">{headers[3]}</th>
                  <th scope="col" className="pl-4 text-right">{headers[4]}</th>
                  <th scope="col" className="pl-4 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="pr-4 whitespace-nowrap text-graphite-600">{shortDate(data.from)}</td>
                  <td className="pr-4 text-ink-900">Balance brought forward</td>
                  <td /><td />
                  <td className="pl-4 text-right whitespace-nowrap"><Amount cents={shown(data.openingBalanceCents)} currency={currency} tone="ink" /></td>
                </tr>
                {data.lines.map((l: any, index: number) => (
                  <tr key={`${l.journalEntryId}-${index}`}>
                    <td className="pr-4 whitespace-nowrap text-graphite-600">{shortDate(l.date)}</td>
                    <td className="pr-4 text-ink-900">
                      {l.kind}{l.particulars ? <span className="text-graphite-600"> · {l.particulars}</span> : null}
                    </td>
                    <td className="pl-4 text-right whitespace-nowrap">{l.chargeCents ? <Amount cents={shown(l.chargeCents)} currency={currency} /> : null}</td>
                    <td className="pl-4 text-right whitespace-nowrap">{l.creditCents ? <Amount cents={shown(l.creditCents)} currency={currency} /> : null}</td>
                    <td className="pl-4 text-right whitespace-nowrap"><Amount cents={shown(l.balanceCents)} currency={currency} tone="ink" /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">
                    {isCustomer ? 'Balance due' : 'Balance owed'} at {shortDate(data.to)}
                  </th>
                  <td className="ll-total py-2 pl-4 text-right whitespace-nowrap font-semibold"><Amount cents={shown(data.closingBalanceCents)} currency={currency} tone="ink" /></td>
                </tr>
              </tfoot>
            </table>
          </div>
          {data.lines.length === 0 && <p className="text-[13px] text-graphite-600">Nothing was posted for {data.party.name} in this period.</p>}
          {data.openDocuments.length > 0 && (
            <section aria-labelledby="open-documents" className="space-y-1">
              <h3 id="open-documents" className="text-[13.5px] font-semibold text-ink-900">{isCustomer ? 'Invoices still open' : 'Bills still open'}, today</h3>
              <ul className="border-t border-feint-strong text-[13.5px]">
                {data.openDocuments.map((d: any) => (
                  <li key={d.id} className="flex items-baseline justify-between gap-3 border-b border-feint py-1.5">
                    <span className="text-ink-900">{d.number} <span className="text-graphite-600">· due {shortDate(d.dueDate)}</span></span>
                    <Amount cents={shown(d.amountDueCents)} currency={currency} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : null}
    </StatementPage>
  );
}

/** Profit and loss with a column for each class or location, and one for postings with none. */
export function ProfitAndLossByTagView({ onBack, kind }: { onBack: () => void; kind: 'CLASS' | 'LOCATION' }) {
  const { currentOrgId, activeCompany } = useAppStore();
  const { currency, shown } = useStatementFigures();
  const [dateRange, setDateRange] = useState('This Year-to-date');
  const title = kind === 'CLASS' ? 'Profit and loss by class' : 'Profit and loss by location';
  const report = useQuery({
    queryKey: ['reports_pnl_by_tag', currentOrgId, kind, dateRange],
    queryFn: () => apiRequest<any>(`/api/reports/pnl-by-tag?kind=${kind}&dateRange=${encodeURIComponent(dateRange)}`, { fallback: `Failed to fetch the ${title.toLowerCase()}` }),
  });
  const data = report.data;
  const columns: Array<{ id: string | null; name: string }> = data?.columns || [];
  const sections = data ? [
    { title: 'Income', section: data.income },
    { title: 'Cost of sales', section: data.costOfSales },
    { title: 'Expenses', section: data.expenses },
  ] : [];
  const isEmpty = data && sections.every((s) => s.section.rows.length === 0);
  const csvRows = data ? [
    ['Account', ...columns.map((c) => c.name), 'Total'],
    ...sections.flatMap(({ title: heading, section }) => [
      [heading],
      ...section.rows.map((r: any) => [`${r.code} ${r.name}`, ...r.amounts.map((m: number) => m / 100), r.totalCents / 100]),
      [`Total ${heading.toLowerCase()}`, ...section.amounts.map((m: number) => m / 100), section.totalCents / 100],
    ]),
    ['Net profit', ...data.net.map((m: number) => m / 100), data.netTotalCents / 100],
  ] : [];
  const figureRow = (label: string, values: number[], total: number, strong = false, key?: string) => (
    <tr key={key || label} className={strong ? 'font-semibold' : undefined}>
      <th scope="row" className={`pr-4 text-left ${strong ? 'll-total text-ink-900' : 'font-normal text-ink-900'}`}>{label}</th>
      {values.map((value, i) => (
        <td key={columns[i]?.id || 'none'} className={`pl-3 text-right whitespace-nowrap ${strong ? 'll-total' : ''}`}><Amount cents={shown(value)} currency={currency} size="xs" tone={strong ? 'ink' : 'figure'} /></td>
      ))}
      <td className={`pl-3 text-right whitespace-nowrap ${strong ? 'll-total' : ''}`}><Amount cents={shown(total)} currency={currency} size="xs" tone="ink" /></td>
    </tr>
  );
  return (
    <StatementPage
      title={title}
      period={data ? rangeText(data.range) : dateRange}
      onBack={onBack}
      loading={report.isLoading}
      problem={report.isError ? { what: title.toLowerCase(), path: '/api/reports/pnl-by-tag', onRetry: () => report.refetch() } : null}
      controls={<PeriodSelect value={dateRange} onChange={setDateRange} />}
      onCsv={() => downloadCsv(`${kind === 'CLASS' ? 'pnl_by_class' : 'pnl_by_location'}.csv`, csvRows)}
      onPdf={() => FinancialPDFEngine.exportFinancialStatement(
        { title, period: rangeText(data?.range), companyName: activeCompany?.legalName || activeCompany?.name, kraPin: activeCompany?.taxId, currency: 'KES', filename: `${kind === 'CLASS' ? 'pnl_by_class' : 'pnl_by_location'}.pdf` },
        [{ headers: csvRows[0] as string[], rows: csvRows.slice(1).map((row) => row.map((value) => (typeof value === 'number' ? kes(Math.round(value * 100)) : value))) }],
      )}
    >
      {columns.length <= 1 && data ? (
        <EmptyNote>No {kind === 'CLASS' ? 'classes' : 'locations'} yet. Add them in Settings, Classes and locations; the forms that post then offer them.</EmptyNote>
      ) : isEmpty ? (
        <EmptyNote>Nothing is posted to income, cost of sales or expense accounts in this period.</EmptyNote>
      ) : data ? (
        <div className="relative overflow-x-auto">
          <table className="w-full text-[13px]" style={{ minWidth: `${16 + columns.length * 8}rem` }}>
            <caption className="sr-only">{title}, {rangeText(data.range)}, figures in {currency}</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-4 text-left">Account</th>
                {columns.map((c) => <th key={c.id || 'none'} scope="col" className="pl-3 text-right">{c.name}</th>)}
                <th scope="col" className="pl-3 text-right">Total</th>
              </tr>
            </thead>
            {sections.map(({ title: heading, section }) => (
              <tbody key={heading}>
                <tr><th colSpan={columns.length + 2} scope="colgroup" className="pt-4 pb-1 text-left text-[12px] font-semibold uppercase tracking-wide text-graphite-600">{heading}</th></tr>
                {section.rows.map((r: any) => figureRow(`${r.code} ${r.name}`, r.amounts, r.totalCents, false, r.accountId))}
                {figureRow(`Total ${heading.toLowerCase()}`, section.amounts, section.totalCents, true)}
              </tbody>
            ))}
            <tfoot>{figureRow('Net profit', data.net, data.netTotalCents, true)}</tfoot>
          </table>
        </div>
      ) : null}
    </StatementPage>
  );
}
