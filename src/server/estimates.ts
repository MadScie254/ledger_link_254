import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import type { SalesOrderLineInput } from './salesOrders';

export interface EstimateInput {
  orgId: string;
  customerId: string;
  estimateDate: string;
  expiryDate?: string;
  notes?: string;
  lines: SalesOrderLineInput[];
  idempotencyKey?: string;
  actor: string;
}

export type EstimateStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED';

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mapEstimate(row: any) {
  const customer = one(row.customer);
  const invoice = one(row.invoice);
  const order = one(row.sales_order);
  return {
    id: row.id,
    estimateNumber: row.estimate_number,
    customerId: row.customer_id,
    customerName: customer?.display_name ?? null,
    estimateDate: row.estimate_date,
    expiryDate: row.expiry_date,
    status: row.status,
    currency: row.currency,
    subtotalCents: Number(row.subtotal_cents) || 0,
    taxCents: Number(row.tax_cents) || 0,
    totalCents: Number(row.total_cents) || 0,
    notes: row.notes,
    declineReason: row.decline_reason,
    invoiceId: row.invoice_id,
    invoiceNumber: invoice?.invoice_number ?? null,
    invoiceStatus: invoice?.status ?? null,
    salesOrderId: row.sales_order_id,
    salesOrderNumber: order?.order_number ?? null,
    convertedAt: row.converted_at,
    createdAt: row.created_at,
    lines: ((row.estimate_lines || []) as any[])
      .map((line) => ({
        id: line.id,
        linePosition: line.line_position,
        description: line.description,
        inventoryItemId: line.inventory_item_id,
        itemName: one(line.item)?.name ?? null,
        itemType: one(line.item)?.type ?? null,
        accountId: line.account_id,
        quantity: Number(line.quantity),
        unitPriceCents: Number(line.unit_price_cents) || 0,
        taxRate: Number(line.tax_rate) || 0,
        amountCents: Number(line.amount_cents) || 0,
        taxCents: Number(line.tax_cents) || 0,
      }))
      .sort((a, b) => a.linePosition - b.linePosition),
  };
}

const lineFor = (line: SalesOrderLineInput) => ({
  description: line.description.trim(),
  accountId: line.accountId,
  inventoryItemId: line.inventoryItemId || null,
  quantity: line.quantity,
  unitPriceCents: line.unitPriceCents,
  taxRate: line.taxRate ?? 0,
});

/**
 * Quotes to customers. Saving, status changes and conversion each run in one
 * Postgres function (save_estimate, set_estimate_status, convert_estimate);
 * an estimate posts nothing until it becomes an invoice.
 */
export class EstimateService {
  static async getEstimates(orgId: string) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => supabase
      .from('estimates')
      .select(`
        *,
        estimate_lines(*, item:inventory_items(name, type)),
        customer:customers(display_name),
        invoice:invoices(invoice_number, status),
        sales_order:sales_orders(order_number)
      `)
      .eq('org_id', orgId)
      .order('estimate_date', { ascending: false })
      .order('id')
      .range(from, to));
    return rows.map(mapEstimate);
  }

  /** Creates an estimate, or rewrites one (its lines replaced) when estimateId is given. */
  static async saveEstimate(input: EstimateInput, estimateId?: string): Promise<{ id: string; estimateNumber: string; totalCents: number }> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('save_estimate', {
      p_org_id: input.orgId,
      p_estimate_id: estimateId || null,
      p_customer_id: input.customerId,
      p_estimate_date: input.estimateDate,
      p_expiry_date: input.expiryDate || null,
      p_notes: input.notes?.trim() || null,
      p_actor: input.actor,
      p_lines: input.lines.map(lineFor),
      p_idempotency_key: input.idempotencyKey || null,
    });
    if (error) throw error;
    return data as { id: string; estimateNumber: string; totalCents: number };
  }

  static async setStatus(orgId: string, estimateId: string, status: EstimateStatus, reason: string | undefined, actor: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('set_estimate_status', {
      p_org_id: orgId,
      p_estimate_id: estimateId,
      p_status: status,
      p_reason: reason?.trim() || null,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { estimateNumber: string; status: string };
  }

  /** Raises the invoice (posted) or the sales order (recorded) for an estimate. */
  static async convert(orgId: string, estimateId: string, target: 'INVOICE' | 'SALES_ORDER', date: string, dueDate: string | undefined, actor: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('convert_estimate', {
      p_org_id: orgId,
      p_estimate_id: estimateId,
      p_target: target,
      p_date: date,
      p_due_date: dueDate || null,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { target: 'INVOICE' | 'SALES_ORDER'; id: string; number: string };
  }
}
