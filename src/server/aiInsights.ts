import { GoogleGenAI } from '@google/genai';
import { ReportsService } from './reports';
import { AccountService } from './accounts';

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export class AIInsightsService {
  /**
   * Builds a compact real-data financial snapshot for the org (P&L, A/R and
   * A/P aging, chart of account balances) and asks Gemini to answer a
   * question or generate an insight grounded in it. Replaces what was
   * previously a fully static/hardcoded "AI" panel with fabricated
   * numbers.
   */
  static async ask(orgId: string, question: string): Promise<string> {
    if (!ai) {
      throw new Error('Gemini API key not configured on server.');
    }

    const period = new Date().toISOString().substring(0, 7);
    const [pnl, arAging, apAging, balances] = await Promise.all([
      ReportsService.getProfitAndLoss(orgId, period).catch(() => null),
      ReportsService.getARAging(orgId).catch(() => null),
      ReportsService.getAPAging(orgId).catch(() => null),
      AccountService.getAccountBalances(orgId).catch(() => null)
    ]);

    const toKES = (cents: number) => `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 2 })}`;

    const totalIncome = (pnl?.income || []).reduce((s: number, i: any) => s + i.amountCents, 0);
    const totalExpenses = (pnl?.expenses || []).reduce((s: number, i: any) => s + i.amountCents, 0) +
      (pnl?.costOfSales || []).reduce((s: number, i: any) => s + i.amountCents, 0);

    const context = `
You are a financial assistant embedded in an accounting app. Answer the user's
question using ONLY the real data below. If the data doesn't cover the
question, say so plainly rather than inventing numbers. Be concise (under
150 words), specific, and cite actual figures from this snapshot.

FINANCIAL SNAPSHOT (this calendar month, ${period}):
- Total income: ${toKES(totalIncome)}
- Total expenses (incl. COGS): ${toKES(totalExpenses)}
- Net: ${toKES(totalIncome - totalExpenses)}
- Open receivables (A/R): ${arAging ? toKES(arAging.grandTotalCents) : 'unavailable'} across ${arAging?.rows.length ?? 0} unpaid invoice(s)
- Open payables (A/P): ${apAging ? toKES(apAging.grandTotalCents) : 'unavailable'} across ${apAging?.rows.length ?? 0} unpaid bill(s)

USER QUESTION: ${question}
`.trim();

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: context }] }],
      config: { temperature: 0.3 }
    });

    const text = response.text;
    if (!text) throw new Error('No response from Gemini.');
    return text;
  }
}
