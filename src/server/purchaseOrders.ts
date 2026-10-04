import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';

export interface PurchaseOrderLineInput {
  description: string;
  accountId: string;
  inventoryItemId?: string;
  quantity: number;
  unitCostCents: number;
  taxRate?: number;
}

function one(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function mapPurchaseOrder(row: any) {
  const lines = ((row.purchase_order_lines || []) as any[])
    .map((line) => ({
      id: line.id,
      position: line.line_position,
      description: line.description,
      accountId: line.account_id,
      inventoryItemId: line.inventory_item_id,
      quantity: Number(line.quantity) || 0,
      quantityBilled: Number(line.quantity_billed) || 0,
      unitCostCents: Number(line.unit_cost_cents) || 0,
      taxRate: Number(line.tax_rate) || 0,
      amountCents: Number(line.amount_cents) || 0,
      taxCents: Number(line.tax_cents) || 0,
    }))
    .sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    number: row.number,
    vendorId: row.vendor_id,
    vendorName: one(row.vendor)?.display_name ?? null,
    orderDate: row.order_date,
    expectedDate: row.expected_date,
    memo: row.memo,
    currency: row.currency,
    subtotalCents: Number(row.subtotal_cents) || 0,
    taxCents: Number(row.tax_cents) || 0,
    totalCents: Number(row.total_cents) || 0,
    status: row.status as 'OPEN' | 'BILLED' | 'CLOSED' | 'CANCELLED',
    partlyBilled: lines.some((line) => line.quantityBilled > 0),
    closeReason: row.close_reason,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    lines,
    bills: ((row.bills || []) as any[]).map((bill) => ({
      id: bill.id,
      billNumber: bill.bill_number,
      date: bill.date,
      totalCents: Number(bill.total_cents) || 0,
      status: bill.status,
    })),
  };
}

/**
 * Orders placed with suppliers. An order posts nothing; billing it, in full
 * or for what has arrived, posts a bill through public.bill_purchase_order.
 */
export class PurchaseOrderService {
  static async list(orgId: string, filter: { vendorId?: string } = {}) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => {
      let request = supabase
        .from('purchase_orders')
        .select(`
          *,
          purchase_order_lines(*),
          vendor:vendors(display_name),
          bills!bills_org_purchase_order_fkey(id, bill_number, date, total_cents, status)
        `)
        .eq('org_id', orgId);
      if (filter.vendorId) request = request.eq('vendor_id', filter.vendorId);
      return request.order('order_date', { ascending: false }).order('id').range(from, to);
    });
    return rows.map(mapPurchaseOrder);
  }

  static async save(input: {
    orgId: string; id?: string; vendorId: string; orderDate: string; expectedDate?: string; memo?: string;
    lines: PurchaseOrderLineInput[]; actor: string; idempotencyKey?: string;
  }) {
    const { data, error } = await getSupabase().rpc('save_purchase_order', {
      p_org_id: input.orgId,
      p_purchase_order_id: input.id || null,
      p_vendor_id: input.vendorId,
      p_order_date: input.orderDate,
      p_expected_date: input.expectedDate || null,
      p_memo: input.memo?.trim() || null,
      p_lines: input.lines.map((line) => ({
        description: line.description.trim(),
        accountId: line.accountId,
        inventoryItemId: line.inventoryItemId || null,
        quantity: line.quantity,
        unitCostCents: Math.trunc(line.unitCostCents),
        taxRate: line.taxRate ?? 0,
      })),
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey || null,
    });
    if (error) throw error;
    return data as { id: string; number: string; totalCents: number };
  }

  static async setStatus(orgId: string, id: string, status: 'OPEN' | 'CLOSED', reason: string | undefined, actor: string) {
    const { data, error } = await getSupabase().rpc('set_purchase_order_status', {
      p_org_id: orgId,
      p_purchase_order_id: id,
      p_status: status,
      p_reason: reason?.trim() || null,
      p_actor: actor,
    });
    if (error) throw error;
    return data as { number: string; status: string };
  }

  static async bill(input: {
    orgId: string; id: string; billDate: string; dueDate: string; supplierReference?: string;
    quantities?: Array<{ position: number; quantity: number }>; actor: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('bill_purchase_order', {
      p_org_id: input.orgId,
      p_purchase_order_id: input.id,
      p_bill_date: input.billDate,
      p_due_date: input.dueDate,
      p_supplier_reference: input.supplierReference?.trim() || null,
      p_quantities: input.quantities ?? null,
      p_actor: input.actor,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw error;
    return data as { billId: string; billNumber: string; status: string };
  }
}
