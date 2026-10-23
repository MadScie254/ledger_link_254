interface CollectionForReview {
  status: string; total_cents: number; banked_cents: number | null; variance_cents: number | null;
  statementMatched: boolean;
}

export function depositReviewSummary(collections: CollectionForReview[]) {
  const summary = { awaitingSecondCount: 0, awaitingBanking: 0, awaitingStatementMatch: 0,
    matched: 0, unbankedCents: 0, varianceCents: 0 };
  for (const item of collections) {
    if (item.status === 'AWAITING_SECOND_COUNT') summary.awaitingSecondCount++;
    if (item.status === 'COUNTED') {
      summary.awaitingBanking++;
      summary.unbankedCents += Number(item.total_cents);
    }
    if (item.status === 'BANKED') {
      summary.varianceCents += Number(item.variance_cents || 0);
      if (item.statementMatched) summary.matched++;
      else summary.awaitingStatementMatch++;
    }
  }
  return summary;
}
