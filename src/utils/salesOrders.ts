/**
 * Sales orders: the arithmetic and rules the order screen shows before
 * anything is saved. The database (create_sales_order, set_sales_order_status)
 * applies the same rules and is the authority; these exist so the preview
 * matches what will be stored to the cent.
 */

export type SalesOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

/** Where an order can go next. Cancelled is final; a completed order can be reopened. */
const NEXT_STATUSES: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  OPEN: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: [],
};

export function nextStatuses(status: SalesOrderStatus): SalesOrderStatus[] {
  return NEXT_STATUSES[status] ?? [];
}

/**
 * An order with an invoice can be cancelled only once that invoice is void;
 * otherwise the sale would stay in the books for an order that never happened.
 */
export function cancelBlockedByInvoice(invoiceStatus: string | null | undefined): boolean {
  return Boolean(invoiceStatus) && invoiceStatus !== 'VOID';
}

/** Stock is counted for every item type except services. */
export function isStockedItemType(type: string | null | undefined): boolean {
  return !/service/i.test(type || '');
}

function decimalPlaces(text: string): number {
  const match = /\.(\d+)$/.exec(text);
  return match ? match[1].length : 0;
}

/** A plain decimal: digits, at most one point, no sign, no exponent. */
const DECIMAL = /^\d+(\.\d+)?$/;

/**
 * Checks a quantity as typed. Returns a sentence describing the problem, or
 * null when it is acceptable. Stocked items are counted in whole units.
 */
export function quantityProblem(text: string, stocked: boolean): string | null {
  const value = text.trim();
  if (!DECIMAL.test(value)) return 'Enter a quantity, such as 2 or 1.5.';
  const quantity = Number(value);
  if (!(quantity > 0)) return 'The quantity must be above zero.';
  if (quantity > 1_000_000_000) return 'The quantity is too large.';
  if (decimalPlaces(value) > 3) return 'Use at most three decimals.';
  if (stocked && !Number.isInteger(quantity)) return 'Stock items are counted in whole units.';
  return null;
}

/** Checks a VAT rate as typed; null when acceptable. */
export function taxRateProblem(text: string): string | null {
  const value = text.trim() || '0';
  if (!DECIMAL.test(value)) return 'Enter a VAT rate such as 16 or 0.';
  if (Number(value) > 100) return 'The VAT rate cannot be above 100.';
  if (decimalPlaces(value) > 2) return 'Use at most two decimals for the VAT rate.';
  return null;
}

/** A non-negative decimal as an exact fraction: digits / 10^scale. */
function toScaled(text: string): { digits: bigint; scale: bigint } {
  const value = text.trim();
  const [whole, fraction = ''] = value.split('.');
  return { digits: BigInt(`${whole}${fraction}` || '0'), scale: 10n ** BigInt(fraction.length) };
}

/** Rounds a non-negative fraction n / d to the nearest integer, halves away from zero. */
function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/**
 * Line amount and VAT in cents, computed exactly as Postgres does:
 * amount = round(quantity x unit price), VAT = round(amount x rate / 100).
 * Both inputs are the text typed in the form, so 1.115 stays 1.115 rather
 * than becoming 1.11499999 in floating point.
 */
export function lineAmounts(quantityText: string, unitPriceCents: number, taxRateText: string): { amountCents: number; taxCents: number } {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new RangeError('The unit price must be whole, non-negative cents.');
  if (!DECIMAL.test(quantityText.trim())) throw new RangeError('The quantity is not a plain decimal.');
  const rate = taxRateText.trim() || '0';
  if (!DECIMAL.test(rate)) throw new RangeError('The VAT rate is not a plain decimal.');

  const quantity = toScaled(quantityText);
  const amount = roundHalfUp(quantity.digits * BigInt(unitPriceCents), quantity.scale);
  const taxRate = toScaled(rate);
  const tax = roundHalfUp(amount * taxRate.digits, taxRate.scale * 100n);
  return { amountCents: Number(amount), taxCents: Number(tax) };
}

export function orderTotals(lines: Array<{ amountCents: number; taxCents: number }>): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const taxCents = lines.reduce((sum, line) => sum + line.taxCents, 0);
  return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents };
}

export interface StockLine {
  itemId: string | null | undefined;
  itemName?: string | null;
  itemType?: string | null;
  quantity: number;
  quantityOnHand?: number | null;
}

export interface StockEffect {
  itemId: string;
  name: string;
  quantity: number;
  onHand: number;
  after: number;
}

/**
 * What completing an order does to each stocked item: how many go out and
 * what the count will be afterwards. Lines for the same item are combined;
 * services are left out. A negative `after` means more is going out than the
 * count says is on hand.
 */
export function stockEffects(lines: StockLine[]): StockEffect[] {
  const byItem = new Map<string, StockEffect>();
  for (const line of lines) {
    if (!line.itemId || !isStockedItemType(line.itemType)) continue;
    const current = byItem.get(line.itemId) || {
      itemId: line.itemId,
      name: line.itemName || 'Stock item',
      quantity: 0,
      onHand: Number(line.quantityOnHand ?? 0),
      after: 0,
    };
    current.quantity += line.quantity;
    byItem.set(line.itemId, current);
  }
  return [...byItem.values()]
    .map((effect) => ({ ...effect, after: effect.onHand - effect.quantity }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A price typed in shillings ("750", "750.5", "1,250.00") as whole cents,
 * read from the digits rather than through floating point. Null when it is
 * not a plain amount with at most two decimals.
 */
export function centsFromAmountText(text: string): number | null {
  const value = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  return cents > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(cents);
}

/** The largest line the database accepts (quantity x unit price, in cents). */
export const MAX_LINE_CENTS = 900_000_000_000_000;
