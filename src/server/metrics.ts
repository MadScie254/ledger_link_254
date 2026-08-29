import { getSupabase } from './supabase';
import { CurrencyService } from './currency';

export class DashboardService {
  static async getMetrics(orgId: string) {
    const supabase = getSupabase();
    
    // 1. Calculate Money In (Unpaid Invoices)
    const { data: invoices, error: invoicesError } = await supabase
      .from('invoices')
      .select('*')
      .eq('org_id', orgId)
      .neq('status', 'PAID');
      
    if (invoicesError) throw invoicesError;

    let moneyInCents = 0;
    let overdueInvoices = 0;
    let overdueCents = 0;
    
    invoices.forEach(data => {
      moneyInCents += (data.total_cents || 0);
      
      if (data.due_date && new Date(data.due_date) < new Date()) {
        overdueInvoices++;
        overdueCents += (data.total_cents || 0);
      }
    });

    // 2. Calculate Money Out (Unpaid Bills)
    const { data: bills, error: billsError } = await supabase
      .from('bills')
      .select('total_cents')
      .eq('org_id', orgId)
      .neq('status', 'PAID');
      
    if (billsError) throw billsError;
    
    let moneyOutCents = 0;
    bills.forEach(data => {
      moneyOutCents += (data.total_cents || 0);
    });

    // 3. Compute Real Account Balances from Journal Entries
    const { data: lines, error: linesError } = await supabase
      .from('journal_lines')
      .select(`
        debit,
        credit,
        accounts!inner(type)
      `)
      .eq('journal_entries.org_id', orgId)
      // We need to join with journal_entries to filter by orgId
      // Supabase simplifies this if we use a view or just query journal_entries and join lines
      // Let's do it by querying journal_entries with lines and account types.
      ;
      
      // Better way: query journal_entries, inner join lines, inner join accounts
    const { data: entries, error: entriesError } = await supabase
      .from('journal_entries')
      .select(`
        id,
        entry_date,
        lines:journal_lines (
          debit,
          credit,
          account:accounts (type)
        )
      `)
      .eq('org_id', orgId);

    if (entriesError) throw entriesError;

    let cashPositionCents = 0;
    let totalIncomeCents = 0;
    let totalCogsCents = 0;
    let totalExpenseCents = 0;

    const monthlyData: Record<string, { revenue: number, expense: number }> = {};

    entries.forEach(entry => {
      const monthStr = entry.entry_date ? new Date(entry.entry_date).toLocaleString('default', { month: 'short' }) : 'Unknown';
      if (!monthlyData[monthStr]) {
        monthlyData[monthStr] = { revenue: 0, expense: 0 };
      }

      (entry.lines || []).forEach((line: any) => {
        const accType = line.account?.type;
        
        if (accType === 'ASSET') {
          cashPositionCents += (line.debit || 0) - (line.credit || 0);
        }
        if (accType === 'INCOME') {
          const rev = (line.credit || 0) - (line.debit || 0);
          totalIncomeCents += rev;
          monthlyData[monthStr].revenue += Math.round(rev / 100);
        }
        if (accType === 'COGS') {
          totalCogsCents += (line.debit || 0) - (line.credit || 0);
        }
        if (accType === 'EXPENSE') {
          const exp = (line.debit || 0) - (line.credit || 0);
          totalExpenseCents += exp;
          monthlyData[monthStr].expense += Math.round(exp / 100);
        }
      });
    });

    const netProfitCents = totalIncomeCents - totalCogsCents - totalExpenseCents;

    // 4. Calculate Unrealized Foreign Exchange Gain / Loss
    let unrealizedFX = null;
    try {
      unrealizedFX = await CurrencyService.calculateUnrealizedFX(orgId, 'KES');
    } catch (e) {
      console.warn('Failed to calculate unrealized FX:', e);
    }

    // 5. Generate trend data for the chart based on the totals
    const monthsOrder = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyTrends = Object.entries(monthlyData)
      .map(([month, data]) => ({ month, revenue: data.revenue, expense: data.expense }))
      .sort((a, b) => monthsOrder.indexOf(a.month) - monthsOrder.indexOf(b.month));


    return {
      cashPositionCents,
      moneyInCents,
      overdueInvoices,
      overdueCents,
      moneyOutCents,
      totalIncomeCents,
      totalCogsCents,
      totalExpenseCents,
      netProfitCents,
      monthlyTrends,
      unrealizedFX
    };
  }
}
