import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../../utils/apiRequest';
import { todayIn } from '../../utils/dates';
import { Amount } from '../ledger/Amount';
import { Mark } from '../ledger/Mark';
import { LoadProblem, SkeletonRows, buttonClass } from '../ledger/Page';

interface Valuation {
  startDate: string | null;
  itemsValueCents: number;
  ledgerValueCents: number;
  items: Array<{
    itemId: string; name: string; sku: string | null; quantity: number;
    valueCents: number; averageCostCents: number | null; lastCostCents: number;
  }>;
}

interface StockRow { id: string; name: string; quantityOnHand: number; costCents: number }

/**
 * Stock value in the books. Before it is turned on, an owner or admin sets
 * the date and the cost of what is on hand; afterwards every movement posts
 * its value and this shows each item at its average cost beside the
 * Inventory account.
 */
export function StockValuationPanel({ orgId, currency, timeZone, canStart, stockItems }: {
  orgId: string;
  currency: string;
  timeZone?: string | null;
  canStart: boolean;
  stockItems: StockRow[];
}) {
  const queryClient = useQueryClient();
  const valuation = useQuery({
    queryKey: ['stock-valuation', orgId],
    queryFn: () => apiRequest<Valuation>('/api/inventory/valuation', { fallback: 'The stock value could not be read.' }),
  });
  const [startDate, setStartDate] = useState(() => todayIn(timeZone));
  const [costs, setCosts] = useState<Record<string, string>>({});
  const onHand = stockItems.filter((item) => item.quantityOnHand > 0);

  useEffect(() => {
    setCosts((prev) => {
      const next = { ...prev };
      for (const item of onHand) if (next[item.id] === undefined) next[item.id] = (item.costCents / 100).toFixed(2);
      return next;
    });
  }, [onHand.map((item) => `${item.id}:${item.costCents}`).join(',')]);

  const centsOf = (value: string | undefined) => Math.round(Number(value || 0) * 100);
  const openingTotal = onHand.reduce((sum, item) => sum + item.quantityOnHand * centsOf(costs[item.id]), 0);
  const costsValid = onHand.every((item) => Number.isFinite(Number(costs[item.id] || 0)) && Number(costs[item.id] || 0) >= 0);

  const start = useMutation({
    mutationFn: () => apiRequest<{ valueCents: number; items: number }>('/api/inventory/valuation/start', {
      body: { startDate, costs: onHand.map((item) => ({ itemId: item.id, unitCostCents: centsOf(costs[item.id]) })) },
      fallback: 'Stock valuation could not be turned on.',
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock-valuation', orgId] });
      queryClient.invalidateQueries({ queryKey: ['inventory', orgId] });
    },
  });

  if (valuation.isError) return <LoadProblem what="the stock value" path="/api/inventory/valuation" onRetry={() => valuation.refetch()} />;
  if (valuation.isLoading || !valuation.data) return <SkeletonRows label="Loading the stock value" />;
  const report = valuation.data;

  if (!report.startDate) {
    return (
      <div className="max-w-3xl space-y-4">
        <p className="text-[14px] leading-relaxed text-ink-900">
          Stock is counted but not yet valued in the books, so selling stock posts no cost of goods sold and gross profit
          reads high. Turn on stock valuation to keep each item at its average cost: purchases go to Inventory, each sale
          posts its cost of goods sold, and counts post what was gained or lost.
        </p>
        <p className="text-[13px] text-graphite-600">
          The stock on hand on the start date is posted to Inventory against Opening Balance Equity (3050), at the cost
          below. Check the costs first: this cannot be turned off, and any correction is a journal entry.
        </p>
        {!canStart ? (
          <p className="text-[13.5px] text-ink-900">An owner or admin turns on stock valuation.</p>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); if (costsValid) start.mutate(); }}
            className="space-y-4"
          >
            <label className="block max-w-xs">
              <span className="block text-[13px] font-semibold text-ink-900">Value stock from</span>
              <input type="date" required value={startDate} max={todayIn(timeZone)} onChange={(e) => setStartDate(e.target.value)}
                className="mt-1.5 h-10 w-full border px-3 text-[14px]" />
            </label>
            {onHand.length === 0 ? (
              <p className="text-[13.5px] text-graphite-600">Nothing is on hand, so nothing is posted on the start date.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13.5px]">
                  <caption className="sr-only">Stock on hand and its cost, in {currency}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="pr-4 text-left">Item</th>
                      <th scope="col" className="pr-4 text-right">On hand</th>
                      <th scope="col" className="pr-4 text-right">Cost each ({currency})</th>
                      <th scope="col" className="text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {onHand.map((item) => (
                      <tr key={item.id}>
                        <td className="pr-4 text-ink-900">{item.name}</td>
                        <td className="pr-4 text-right ll-figure">{item.quantityOnHand}</td>
                        <td className="pr-4 text-right">
                          <input
                            type="number" min="0" step="0.01" inputMode="decimal"
                            aria-label={`Cost of each ${item.name}`}
                            value={costs[item.id] ?? ''}
                            onChange={(e) => setCosts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                            className="h-9 w-32 border px-2 text-right text-[14px]"
                          />
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <Amount cents={item.quantityOnHand * centsOf(costs[item.id])} currency={currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={3} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Opening stock value</th>
                      <td className="ll-total py-2 text-right font-semibold"><Amount cents={openingTotal} currency={currency} tone="ink" /></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {start.isError && <p role="alert" className="text-[13.5px] text-ledger-red">{(start.error as Error).message}</p>}
            <button type="submit" disabled={start.isPending || !costsValid || !startDate} className={buttonClass.primary}>
              {start.isPending ? 'Valuing stock' : 'Start valuing stock'}
            </button>
          </form>
        )}
      </div>
    );
  }

  const agrees = report.itemsValueCents === report.ledgerValueCents;
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] text-graphite-600">
        Valued at average cost since {new Date(`${report.startDate}T00:00:00`).toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}.
        Each sale posts its cost of goods sold; each purchase, return and count posts its value.
      </p>
      <p className="text-[13.5px]">
        {agrees ? (
          <Mark kind="tick" label="The Inventory account agrees with the items' value." />
        ) : (
          <span className="text-ink-900">
            The Inventory account holds <Amount cents={report.ledgerValueCents} currency={currency} tone="ink" size="xs" />, the items{' '}
            <Amount cents={report.itemsValueCents} currency={currency} tone="ink" size="xs" />. A journal entry posted straight to an
            Inventory account makes the difference; check the account's entries.
          </span>
        )}
      </p>
      {report.items.length === 0 ? (
        <p className="text-[13.5px] text-graphite-600">Nothing is on hand.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <caption className="sr-only">Stock value by item, in {currency}</caption>
            <thead>
              <tr>
                <th scope="col" className="pr-4 text-left">Item</th>
                <th scope="col" className="pr-4 text-right">On hand</th>
                <th scope="col" className="pr-4 text-right">Average cost</th>
                <th scope="col" className="pr-4 text-right">Last cost</th>
                <th scope="col" className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item) => (
                <tr key={item.itemId}>
                  <td className="pr-4 text-ink-900">{item.name}{item.sku ? <span className="ml-2 text-graphite-600">{item.sku}</span> : null}</td>
                  <td className="pr-4 text-right ll-figure">{item.quantity}</td>
                  <td className="pr-4 text-right whitespace-nowrap">
                    {item.averageCostCents === null ? '–' : <Amount cents={item.averageCostCents} currency={currency} />}
                  </td>
                  <td className="pr-4 text-right whitespace-nowrap"><Amount cents={item.lastCostCents} currency={currency} /></td>
                  <td className="text-right whitespace-nowrap"><Amount cents={item.valueCents} currency={currency} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4} className="ll-total py-2 pr-4 text-left font-semibold text-ink-900">Stock value</th>
                <td className="ll-total py-2 text-right font-semibold"><Amount cents={report.itemsValueCents} currency={currency} tone="ink" /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
