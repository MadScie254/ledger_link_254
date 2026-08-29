import { getSupabase } from './supabase';

export class ReportsService {
  static async getProfitAndLoss(orgId: string, dateRange: string) {
    const supabase = getSupabase();
    
    // Instead of raw joins in TS, we fetch journal lines joined with accounts
    // for this org
    const { data: lines, error } = await supabase
      .from('journal_lines')
      .select(`
        debit,
        credit,
        account:accounts!inner(name, type, code),
        journal_entry:journal_entries!inner(org_id)
      `)
      .eq('journal_entries.org_id', orgId);
      
    if (error) throw error;

    const incomeMap: Record<string, number> = {};
    const cogsMap: Record<string, number> = {};
    const expenseMap: Record<string, number> = {};

    lines.forEach((line: any) => {
      const accountInfo = line.account;
      if (!accountInfo) return;

      if (accountInfo.type === 'INCOME') {
        incomeMap[accountInfo.name] = (incomeMap[accountInfo.name] || 0) + (line.credit || 0) - (line.debit || 0);
      } else if (accountInfo.type === 'COGS') {
        cogsMap[accountInfo.name] = (cogsMap[accountInfo.name] || 0) + (line.debit || 0) - (line.credit || 0);
      } else if (accountInfo.type === 'EXPENSE') {
        expenseMap[accountInfo.name] = (expenseMap[accountInfo.name] || 0) + (line.debit || 0) - (line.credit || 0);
      }
    });

    return {
      income: Object.entries(incomeMap).map(([name, amountCents]) => ({ name, amountCents })),
      costOfSales: Object.entries(cogsMap).map(([name, amountCents]) => ({ name, amountCents })),
      expenses: Object.entries(expenseMap).map(([name, amountCents]) => ({ name, amountCents }))
    };
  }

  static async getBalanceSheet(orgId: string, asOfDate: string) {
    const supabase = getSupabase();
    
    const { data: lines, error } = await supabase
      .from('journal_lines')
      .select(`
        debit,
        credit,
        account:accounts!inner(name, type, code),
        journal_entry:journal_entries!inner(org_id, entry_date)
      `)
      .eq('journal_entries.org_id', orgId)
      .lte('journal_entries.entry_date', asOfDate || new Date().toISOString());

    if (error) throw error;

    const assetMap: Record<string, number> = {};
    const liabilityMap: Record<string, number> = {};
    const equityMap: Record<string, number> = {};

    lines.forEach((line: any) => {
      const accountInfo = line.account;
      if (!accountInfo) return;

      if (accountInfo.type === 'ASSET') {
        assetMap[accountInfo.name] = (assetMap[accountInfo.name] || 0) + (line.debit || 0) - (line.credit || 0);
      } else if (accountInfo.type === 'LIABILITY') {
        liabilityMap[accountInfo.name] = (liabilityMap[accountInfo.name] || 0) + (line.credit || 0) - (line.debit || 0);
      } else if (accountInfo.type === 'EQUITY') {
        equityMap[accountInfo.name] = (equityMap[accountInfo.name] || 0) + (line.credit || 0) - (line.debit || 0);
      }
    });

    return {
      currentAssets: Object.entries(assetMap).filter(([k]) => !k.includes('Equipment')).map(([name, amountCents]) => ({ name, amountCents })),
      nonCurrentAssets: Object.entries(assetMap).filter(([k]) => k.includes('Equipment')).map(([name, amountCents]) => ({ name, amountCents })),
      currentLiabilities: Object.entries(liabilityMap).map(([name, amountCents]) => ({ name, amountCents })),
      equity: Object.entries(equityMap).map(([name, amountCents]) => ({ name, amountCents }))
    };
  }

  static async getCashFlow(orgId: string, dateRange: string) {
    const supabase = getSupabase();
    
    const { data: lines, error } = await supabase
      .from('journal_lines')
      .select(`
        debit,
        credit,
        account:accounts!inner(name, type, code),
        journal_entry:journal_entries!inner(org_id)
      `)
      .eq('journal_entries.org_id', orgId);

    if (error) throw error;

    let netIncome = 0;
    lines.forEach((line: any) => {
      const acc = line.account;
      if (!acc) return;
      if (acc.type === 'INCOME') netIncome += (line.credit || 0) - (line.debit || 0);
      if (acc.type === 'EXPENSE' || acc.type === 'COGS') netIncome -= ((line.debit || 0) - (line.credit || 0));
    });

    const operating = netIncome !== 0 ? [{ name: 'Net Income from Operations', amountCents: netIncome }] : [];

    return {
      operating,
      investing: [],
      financing: [],
      beginningCashCents: 0
    };
  }

  static async getTrialBalance(orgId: string) {
    const supabase = getSupabase();
    
    const { data: lines, error } = await supabase
      .from('journal_lines')
      .select(`
        debit,
        credit,
        account:accounts!inner(code, name, type),
        journal_entry:journal_entries!inner(org_id)
      `)
      .eq('journal_entries.org_id', orgId);

    if (error) throw error;

    const accountMap: Record<string, any> = {};

    lines.forEach((line: any) => {
      const accountInfo = line.account;
      if (!accountInfo) return;

      const code = accountInfo.code;
      if (!accountMap[code]) {
        accountMap[code] = {
          code,
          name: accountInfo.name,
          type: accountInfo.type,
          debitCents: 0,
          creditCents: 0
        };
      }
      
      accountMap[code].debitCents += (line.debit || 0);
      accountMap[code].creditCents += (line.credit || 0);
    });

    const rows = Object.values(accountMap).map((row: any) => {
      if (row.debitCents > row.creditCents) {
        row.debitCents -= row.creditCents;
        row.creditCents = 0;
      } else {
        row.creditCents -= row.debitCents;
        row.debitCents = 0;
      }
      return row;
    }).sort((a: any, b: any) => a.code.localeCompare(b.code));

    return { rows };
  }

  static async getTaxSummary(orgId: string, period: string) {
    const supabase = getSupabase();
    
    const { data: invoices, error: invError } = await supabase
      .from('invoices')
      .select('subtotal_cents, tax_cents')
      .eq('org_id', orgId)
      .neq('status', 'VOID');
      
    if (invError) throw invError;
    
    const { data: bills, error: billError } = await supabase
      .from('bills')
      .select('subtotal_cents, tax_cents')
      .eq('org_id', orgId)
      .neq('status', 'VOID');
      
    if (billError) throw billError;

    let outputVat = 0;
    let standardRatedSales = 0;
    (invoices || []).forEach((inv: any) => {
      outputVat += (inv.tax_cents || 0);
      standardRatedSales += (inv.subtotal_cents || 0);
    });

    let inputVat = 0;
    let claimablePurchases = 0;
    (bills || []).forEach((bill: any) => {
      inputVat += (bill.tax_cents || 0);
      claimablePurchases += (bill.subtotal_cents || 0);
    });

    return {
      period: period || new Date().toISOString().substring(0, 7),
      kraPin: 'P051239847Z',
      outputVat: {
        standardRatedSalesCents: standardRatedSales,
        vatRatePercent: 16,
        taxAmountCents: outputVat
      },
      inputVat: {
        claimablePurchasesCents: claimablePurchases,
        vatRatePercent: 16,
        taxAmountCents: inputVat
      },
      withholdingTaxVat: {
        withholdingRatePercent: 2,
        withheldAmountCents: 0
      },
      netVatPayableCents: outputVat - inputVat,
      etimsVerifiedCount: (invoices || []).length,
      etimsPendingCount: 0
    };
  }

  static async getLedgerLinesForAccount(orgId: string, accountName: string) {
    const supabase = getSupabase();
    
    // Find account by name
    const { data: accounts, error: accountError } = await supabase
      .from('accounts')
      .select('id')
      .eq('org_id', orgId)
      .eq('name', accountName)
      .limit(1);

    if (accountError || !accounts || accounts.length === 0) return [];
    const accountId = accounts[0].id;

    const { data: lines, error: linesError } = await supabase
      .from('journal_lines')
      .select(`
        id,
        debit,
        credit,
        journal_entry:journal_entries!inner(entry_date, source_type, memo, org_id)
      `)
      .eq('account_id', accountId)
      .eq('journal_entries.org_id', orgId)
      .order('journal_entries(entry_date)', { ascending: false });

    if (linesError) throw linesError;

    return (lines || []).map((line: any) => ({
      id: line.id,
      date: line.journal_entry.entry_date,
      sourceType: line.journal_entry.source_type,
      memo: line.journal_entry.memo,
      debit: line.debit,
      credit: line.credit
    }));
  }
}
