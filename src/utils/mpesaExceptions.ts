export type MpesaExceptionKey = 'NO_REFERENCE' | 'NO_RULE' | 'UNKNOWN_MEMBER' | 'CLOSED_FUND' | 'OTHER';

export function mpesaExceptionKey(reason: string): MpesaExceptionKey {
  if (reason.includes('reference blank')) return 'NO_REFERENCE';
  if (reason.includes('No giving rule fits')) return 'NO_RULE';
  if (reason.includes('not a member number')) return 'UNKNOWN_MEMBER';
  if (reason.includes('closed to new giving')) return 'CLOSED_FUND';
  return 'OTHER';
}

/** Every value comes from the existing unposted M-Pesa queue. */
export function mpesaExceptionSummary(receipts: Array<{ amountCents: number; transTime: string; reason: string }>, today: string) {
  const groups = new Map<MpesaExceptionKey, { key: MpesaExceptionKey; count: number; cents: number }>();
  let totalCents = 0;
  let olderThanSevenDays = 0;
  const cutoff = Date.parse(`${today}T00:00:00Z`) - 7 * 24 * 60 * 60 * 1000;
  for (const receipt of receipts) {
    totalCents += receipt.amountCents;
    if (Date.parse(receipt.transTime) < cutoff) olderThanSevenDays++;
    const key = mpesaExceptionKey(receipt.reason);
    const group = groups.get(key) || { key, count: 0, cents: 0 };
    group.count++;
    group.cents += receipt.amountCents;
    groups.set(key, group);
  }
  return { totalCents, olderThanSevenDays, groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)) };
}
