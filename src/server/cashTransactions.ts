import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import type { SalesOrderLineInput } from './salesOrders';

export type CashKind = 'SALES_RECEIPT' | 'EXPENSE' | 'TRANSFER';

export interface ExpenseLineInput {
  description: string;
  accountId: string;
  amountCents: number;
  taxCents?: number;
  inventoryItemId?: string;
  quantity?: number;
}

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mapTransaction(row: any) {
  const account = one(row.money_account);
  const toAccount = one(row.to_account);
  return {
    id: row.id,
    kind: row.kind as CashKind,
    number: row.number,
    date: row.txn_date,
    customerId: row.customer_id,
    vendorId: row.vendor_id,
    partyName: one(row.customer)?.display_name ?? one(row.vendor)?.display_name ?? row.payee_name ?? null,
    moneyAccountId: row.money_account_id,
    moneyAccountName: account ? `${account.code} ${account.name}` : null,
    toAccountId: row.to_account_id,
    toAccountName: toAccount ? `${toAccount.code} ${toAccount.name}` : null,
    reference: row.reference,
    memo: row.memo,
    subtotalCents: Number(row.subtotal_cents) || 0,
    taxCents: Number(row.tax_cents) || 0,
    totalCents: Number(row.total_cents) || 0,
    status: row.status,
    journalEntryId: row.journal_entry_id,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    createdAt: row.created_at,
    lines: ((row.cash_transaction_lines || []) as any[])
      .map((line) => ({
        position: line.line_position,
        description: line.description,
        accountId: line.account_id,
        inventoryItemId: line.inventory_item_id,
        quantity: line.quantity == null ? null : Number(line.quantity),
        unitPriceCents: line.unit_price_cents == null ? null : Number(line.unit_price_cents),
        taxRate: line.tax_rate == null ? null : Number(line.tax_rate),
        amountCents: Number(line.amount_cents) || 0,
        taxCents: Number(line.tax_cents) || 0,
      }))
      .sort((a, b) => a.position - b.position),
  };
}

type Posted = { id: string; number: string; totalCents: number; journalEntryId: string };

/**
 * Sales receipts, expenses and transfers: money in or out at once. Each is
 * posted, and voided, by one Postgres function, with its journal entry,
 * stock movements and audit row in the same transaction.
 */
export class CashTransactionService {
  static async list(orgId: string, kind?: CashKind) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => {
      let request = supabase
        .from('cash_transactions')
        .select(`
          *,
          cash_transaction_lines(*),
          customer:customers(display_name),
          vendor:vendors(display_name),
          money_account:accounts!cash_transactions_org_money_account_fkey(code, name),
          to_account:accounts!cash_transactions_org_to_account_fkey(code, name)
        `)
        .eq('org_id', orgId);
      if (kind) request = request.eq('kind', kind);
      return request.order('txn_date', { ascending: false }).order('id').range(from, to);
    });
    return rows.map(mapTransaction);
  }

  static async recordSalesReceipt(input: {
    orgId: string; customerId?: string; payeeName?: string; date: string; depositAccountId: string;
    reference?: string; memo?: string; lines: SalesOrderLineInput[]; actor: string; idempotencyKey: string;
  }): Promise<Posted> {
    const { data, error } = await getSupabase().rpc('record_sales_receipt', {
      p_org_id: input.orgId,
      p_customer_id: input.customerId || null,
      p_payee_name: input.payeeName?.trim() || null,
      p_txn_date: input.date,
      p_deposit_account_id: input.depositAccountId,
      p_reference: input.reference?.trim() || null,
      p_memo: input.memo?.trim() || null,
      p_lines: input.lines.map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId,
        inventoryItemId: line.inventoryItemId || null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        taxRate: line.taxRate ?? 0,
      })),
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as Posted;
  }

  static async recordExpense(input: {
    orgId: string; vendorId?: string; payeeName?: string; date: string; paidFromAccountId: string;
    reference?: string; memo?: string; lines: ExpenseLineInput[]; actor: string; idempotencyKey: string;
  }): Promise<Posted> {
    const { data, error } = await getSupabase().rpc('record_expense', {
      p_org_id: input.orgId,
      p_vendor_id: input.vendorId || null,
      p_payee_name: input.payeeName?.trim() || null,
      p_txn_date: input.date,
      p_paid_from_account_id: input.paidFromAccountId,
      p_reference: input.reference?.trim() || null,
      p_memo: input.memo?.trim() || null,
      p_lines: input.lines.map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId,
        amountCents: Math.trunc(line.amountCents),
        taxCents: Math.trunc(line.taxCents || 0),
        inventoryItemId: line.inventoryItemId || null,
        quantity: line.quantity ?? null,
      })),
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as Posted;
  }

  static async recordTransfer(input: {
    orgId: string; date: string; fromAccountId: string; toAccountId: string; amountCents: number;
    memo?: string; actor: string; idempotencyKey: string;
  }): Promise<Posted> {
    const { data, error } = await getSupabase().rpc('record_transfer', {
      p_org_id: input.orgId,
      p_txn_date: input.date,
      p_from_account_id: input.fromAccountId,
      p_to_account_id: input.toAccountId,
      p_amount_cents: Math.trunc(input.amountCents),
      p_memo: input.memo?.trim() || null,
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as Posted;
  }

  static async void(orgId: string, id: string, voidDate: string, reason: string, actor: string) {
    const { data, error } = await getSupabase().rpc('void_cash_transaction', {
      p_org_id: orgId,
      p_id: id,
      p_void_date: voidDate,
      p_reason: reason,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { number: string; reversalJournalEntryId: string };
  }
}
