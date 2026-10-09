/**
 * How one payment from a customer is shared across their open invoices,
 * oldest due first, as receive_customer_payment shares it when no amounts
 * are given (20261009000600_customer_payments.sql). What the invoices do
 * not take is kept as the customer's credit.
 */
export interface OpenInvoice {
  id: string;
  invoiceNo: string;
  date: string;
  dueDate: string | null;
  amountDueCents: number;
}

export function oldestDueFirst<T extends OpenInvoice>(invoices: T[]): T[] {
  return invoices.slice().sort((a, b) =>
    (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
    || a.date.localeCompare(b.date)
    || a.invoiceNo.localeCompare(b.invoiceNo)
    || a.id.localeCompare(b.id));
}

export function shareOldestFirst(invoices: OpenInvoice[], amountCents: number, paymentDate?: string) {
  let left = Math.max(0, Math.trunc(amountCents));
  const shares: Array<{ invoiceId: string; invoiceNo: string; amountCents: number; paysInFull: boolean }> = [];
  for (const invoice of oldestDueFirst(invoices.filter((item) => item.amountDueCents > 0 && (!paymentDate || item.date <= paymentDate)))) {
    if (left === 0) break;
    const share = Math.min(left, invoice.amountDueCents);
    shares.push({ invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, amountCents: share, paysInFull: share === invoice.amountDueCents });
    left -= share;
  }
  return { shares, creditCents: left };
}
