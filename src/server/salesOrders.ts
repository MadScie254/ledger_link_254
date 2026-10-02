import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

export interface SalesOrderLineInput {
  description: string;
  accountId: string;
  inventoryItemId?: string;
  quantity: number;
  unitPriceCents: number;
  taxRate?: number;
}

export interface SalesOrderInput {
  orgId: string;
  customerId: string;
  orderDate: string;
  promisedDate?: string;
  notes?: string;
  lines: SalesOrderLineInput[];
  idempotencyKey: string;
  createdBy: string;
}

export type SalesOrderTargetStatus = 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface StockChange {
  itemId: string;
  name: string;
  /** Negative when stock went out (completion), positive when it came back (reopen). */
  quantity: number;
  quantityOnHand: number;
}

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mapLine(row: any) {
  const item = one(row.item);
  return {
    id: row.id,
    linePosition: row.line_position,
    description: row.description,
    inventoryItemId: row.inventory_item_id,
    itemName: item?.name ?? null,
    itemType: item?.type ?? null,
    quantityOnHand: item?.quantity_on_hand ?? null,
    accountId: row.account_id,
    quantity: Number(row.quantity),
    unitPriceCents: Number(row.unit_price_cents) || 0,
    taxRate: Number(row.tax_rate) || 0,
    amountCents: Number(row.amount_cents) || 0,
    taxCents: Number(row.tax_cents) || 0,
  };
}

function mapOrder(row: any) {
  const customer = one(row.customer);
  const invoice = one(row.invoice);
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerId: row.customer_id,
    customerName: customer?.display_name ?? null,
    orderDate: row.order_date,
    promisedDate: row.promised_date,
    status: row.status,
    currency: row.currency,
    subtotalCents: Number(row.subtotal_cents) || 0,
    taxCents: Number(row.tax_cents) || 0,
    totalCents: Number(row.total_cents) || 0,
    notes: row.notes,
    invoiceId: row.invoice_id,
    invoiceNumber: invoice?.invoice_number ?? null,
    invoiceStatus: invoice?.status ?? null,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    lines: ((row.sales_order_lines || []) as any[])
      .map(mapLine)
      .sort((a, b) => a.linePosition - b.linePosition),
  };
}

/**
 * Customer orders. Recording, moving and invoicing all happen inside Postgres
 * functions (create_sales_order, set_sales_order_status, invoice_sales_order)
 * so each is one transaction with its stock changes and audit row.
 */
export class SalesOrderService {
  static async getOrders(orgId: string) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => supabase
      .from('sales_orders')
      .select(`
        *,
        sales_order_lines(*, item:inventory_items(name, type, quantity_on_hand)),
        customer:customers(display_name),
        invoice:invoices(invoice_number, status)
      `)
      .eq('org_id', orgId)
      .order('order_date', { ascending: false })
      .order('id')
      .range(from, to));
    return rows.map(mapOrder);
  }

  static async createOrder(input: SalesOrderInput): Promise<{ id: string; orderNumber: string; totalCents: number }> {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('create_sales_order', {
      p_org_id: input.orgId,
      p_customer_id: input.customerId,
      p_order_date: input.orderDate,
      p_promised_date: input.promisedDate || null,
      p_notes: input.notes?.trim() || null,
      p_created_by: input.createdBy,
      p_lines: input.lines.map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId,
        inventoryItemId: line.inventoryItemId || null,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        taxRate: line.taxRate ?? 0,
      })),
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as { id: string; orderNumber: string; totalCents: number };
  }

  static async setStatus(orgId: string, orderId: string, status: SalesOrderTargetStatus, reason: string | undefined, actor: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('set_sales_order_status', {
      p_org_id: orgId,
      p_order_id: orderId,
      p_status: status,
      p_reason: reason?.trim() || null,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { orderNumber: string; status: string; stockChanges: StockChange[] };
  }

  static async invoiceOrder(orgId: string, orderId: string, issueDate: string, dueDate: string, actor: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('invoice_sales_order', {
      p_org_id: orgId,
      p_order_id: orderId,
      p_issue_date: issueDate,
      p_due_date: dueDate,
      p_created_by: actor,
    });
    if (error) throw error;
    return data as { invoiceId: string; invoiceNumber: string };
  }
}
