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
    // Income less COGS and expenses. Without this the statement can never
    // balance: profit earned in the period sits in the INCOME/COGS/EXPENSE
    // accounts and has no equity account to land in until a closing entry is
    // posted, so assets exceed liabilities + equity by exactly the profit.
    let retainedEarnings = 0;

    lines.forEach((line: any) => {
      const accountInfo = line.account;
      if (!accountInfo) return;

      if (accountInfo.type === 'ASSET') {
        assetMap[accountInfo.name] = (assetMap[accountInfo.name] || 0) + (line.debit || 0) - (line.credit || 0);
      } else if (accountInfo.type === 'LIABILITY') {
        liabilityMap[accountInfo.name] = (liabilityMap[accountInfo.name] || 0) + (line.credit || 0) - (line.debit || 0);
      } else if (accountInfo.type === 'EQUITY') {
        equityMap[accountInfo.name] = (equityMap[accountInfo.name] || 0) + (line.credit || 0) - (line.debit || 0);
      } else if (accountInfo.type === 'INCOME') {
        retainedEarnings += (line.credit || 0) - (line.debit || 0);
      } else if (accountInfo.type === 'COGS' || accountInfo.type === 'EXPENSE') {
        retainedEarnings -= (line.debit || 0) - (line.credit || 0);
      }
    });

    const equity = Object.entries(equityMap).map(([name, amountCents]) => ({ name, amountCents }));
    if (retainedEarnings !== 0) {
      equity.push({ name: 'Retained earnings (current period)', amountCents: retainedEarnings });
    }

    return {
      currentAssets: Object.entries(assetMap).filter(([k]) => !k.includes('Equipment')).map(([name, amountCents]) => ({ name, amountCents })),
      nonCurrentAssets: Object.entries(assetMap).filter(([k]) => k.includes('Equipment')).map(([name, amountCents]) => ({ name, amountCents })),
      currentLiabilities: Object.entries(liabilityMap).map(([name, amountCents]) => ({ name, amountCents })),
      equity
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

    const { data: org } = await supabase
      .from('organizations')
      .select('tax_id')
      .eq('id', orgId)
      .maybeSingle();

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

    const { data: etimsSubmissions } = await supabase
      .from('etims_submissions')
      .select('status')
      .eq('org_id', orgId);

    const etimsVerifiedCount = (etimsSubmissions || []).filter((s: any) => s.status === 'VERIFIED').length;
    const etimsPendingCount = (etimsSubmissions || []).filter((s: any) => s.status !== 'VERIFIED').length;

    return {
      period: period || new Date().toISOString().substring(0, 7),
      kraPin: org?.tax_id || null,
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
      etimsVerifiedCount,
      etimsPendingCount
    };
  }

  static async getARAging(orgId: string) {
    const supabase = getSupabase();
    const { data: invoices, error } = await supabase
      .from('invoices')
      .select('id, invoice_number, customer_id, due_date, amount_due_cents, status, customers(display_name)')
      .eq('org_id', orgId)
      .neq('status', 'VOID')
      .neq('status', 'PAID')
      .gt('amount_due_cents', 0);

    if (error) throw error;
    return this.bucketByDueDate((invoices || []).map((inv: any) => ({
      id: inv.id,
      referenceNo: inv.invoice_number,
      partyName: inv.customers?.display_name || 'Unknown Customer',
      dueDate: inv.due_date,
      amountDueCents: inv.amount_due_cents
    })));
  }

  static async getAPAging(orgId: string) {
    const supabase = getSupabase();
    const { data: bills, error } = await supabase
      .from('bills')
      .select('id, bill_number, vendor_id, due_date, amount_due_cents, status, vendors(display_name)')
      .eq('org_id', orgId)
      .neq('status', 'VOID')
      .neq('status', 'PAID')
      .gt('amount_due_cents', 0);

    if (error) throw error;
    return this.bucketByDueDate((bills || []).map((bill: any) => ({
      id: bill.id,
      referenceNo: bill.bill_number,
      partyName: bill.vendors?.display_name || 'Unknown Vendor',
      dueDate: bill.due_date,
      amountDueCents: bill.amount_due_cents
    })));
  }

  private static bucketByDueDate(items: Array<{ id: string; referenceNo: string; partyName: string; dueDate: string | null; amountDueCents: number }>) {
    const today = new Date();
    const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0 };
    const rows = items.map(item => {
      const daysPastDue = item.dueDate
        ? Math.floor((today.getTime() - new Date(item.dueDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      let bucket: keyof typeof buckets = 'current';
      if (daysPastDue > 90) bucket = 'days90plus';
      else if (daysPastDue > 60) bucket = 'days61to90';
      else if (daysPastDue > 30) bucket = 'days31to60';
      else if (daysPastDue > 0) bucket = 'days1to30';

      buckets[bucket] += item.amountDueCents;

      return { ...item, daysPastDue: Math.max(daysPastDue, 0), bucket };
    });

    return { rows, totals: buckets, grandTotalCents: Object.values(buckets).reduce((a, b) => a + b, 0) };
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
