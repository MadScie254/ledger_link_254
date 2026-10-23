export interface PostedGift {
  id: string;
  received_on: string;
  amount_cents: number | string;
  journal_entry_id: string | null;
}

/** A member statement reads posted contributions; it never posts to the ledger. */
export function givingStatement<T extends PostedGift>(gifts: readonly T[], from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    throw new Error('The giving statement period starts after it ends or has an invalid date.');
  }
  const rows = gifts.filter((gift) => gift.journal_entry_id && gift.received_on >= from && gift.received_on <= to)
    .sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id));
  const totalCents = rows.reduce((total, gift) => {
    const amount = Number(gift.amount_cents);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('A posted gift has an invalid amount.');
    return total + amount;
  }, 0);
  if (!Number.isSafeInteger(totalCents)) throw new Error('The giving statement total is too large.');
  return { gifts: rows, totalCents };
}
