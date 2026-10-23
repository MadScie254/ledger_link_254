export type GivingPlanStatus = 'PLANNED' | 'DUE' | 'PARTIAL' | 'MISSED' | 'MET';

/** An intention is never a ledger balance; compare it with posted giving. */
export function givingPlanStatus(expectedCents: number, receivedCents: number, month: string, currentMonth: string): GivingPlanStatus {
  if (receivedCents >= expectedCents) return 'MET';
  if (receivedCents > 0) return 'PARTIAL';
  if (month < currentMonth) return 'MISSED';
  if (month > currentMonth) return 'PLANNED';
  return 'DUE';
}
