import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';

export interface ItemInput {
  name?: string;
  itemType?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  unitOfMeasure?: string;
  description?: string;
  priceCents?: number;
  costCents?: number;
  taxRate?: number;
  incomeAccountId?: string;
  expenseAccountId?: string;
  quantityOnHand?: number;
  reorderPoint?: number;
  targetStock?: number;
  preferredVendorId?: string;
  location?: string;
  notes?: string;
  status?: 'Active' | 'Inactive';
}

// Every editable column. quantity_on_hand is absent on purpose: it changes
// only through stock adjustments and orders, each recorded as a movement.
const COLUMNS: Record<Exclude<keyof ItemInput, 'quantityOnHand'>, string> = {
  name: 'name',
  itemType: 'type',
  sku: 'sku',
  barcode: 'barcode',
  category: 'category',
  unitOfMeasure: 'unit_of_measure',
  description: 'description',
  priceCents: 'unit_price_cents',
  costCents: 'cost_price_cents',
  taxRate: 'tax_rate',
  incomeAccountId: 'income_account_id',
  expenseAccountId: 'cogs_account_id',
  reorderPoint: 'reorder_point',
  targetStock: 'target_stock',
  preferredVendorId: 'preferred_vendor_id',
  location: 'location',
  notes: 'notes',
  status: 'status',
};

function mapItem(row: any) {
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    description: row.description,
    category: row.category,
    type: row.type,
    unitOfMeasure: row.unit_of_measure,
    quantityOnHand: row.quantity_on_hand,
    reorderPoint: row.reorder_point,
    targetStock: row.target_stock,
    unitPriceCents: row.unit_price_cents,
    costPriceCents: row.cost_price_cents,
    taxRate: row.tax_rate == null ? null : Number(row.tax_rate),
    incomeAccountId: row.income_account_id,
    cogsAccountId: row.cogs_account_id,
    assetAccountId: row.asset_account_id,
    preferredVendorId: row.preferred_vendor_id,
    location: row.location,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class InventoryService {
  static async getItems(orgId: string) {
    const supabase = getSupabase();
    const data = await fetchAllRows<any>((from, to) => supabase
      .from('inventory_items')
      .select('*')
      .eq('org_id', orgId)
      .order('name')
      .order('id')
      .range(from, to));
    return data.map(mapItem);
  }

  /** Creates an item. Its starting quantity is recorded as its opening movement. */
  static async createItem(orgId: string, input: ItemInput) {
    const supabase = getSupabase();
    if (!input.name?.trim()) throw new UserError('A name is required.');
    const values: Record<string, unknown> = {
      org_id: orgId,
      type: 'Physical Product',
      category: 'General',
      unit_price_cents: 0,
      cost_price_cents: 0,
      quantity_on_hand: input.quantityOnHand || 0,
      reorder_point: 0,
      status: 'Active',
    };
    for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof typeof COLUMNS, string]>) {
      if (input[key] !== undefined) values[column] = input[key];
    }
    const { data, error } = await supabase
      .from('inventory_items')
      .insert(values)
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  static async updateItem(orgId: string, id: string, input: ItemInput) {
    const supabase = getSupabase();
    if (input.quantityOnHand !== undefined) {
      throw new UserError('Stock counts change through a stock adjustment, so each change is recorded with its reason.');
    }
    const updateData: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof typeof COLUMNS, string]>) {
      if (input[key] !== undefined) updateData[column] = input[key];
    }
    if (Object.keys(updateData).length === 0) return;
    const { data, error } = await supabase
      .from('inventory_items')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new UserError('Stock item not found in this organization.', 404);
  }

  /**
   * Sets an item's count to what was counted, recording the difference as a
   * movement with its reason (public.adjust_stock). A retry with the same key
   * changes nothing further.
   */
  static async adjustStock(orgId: string, itemId: string, countedQuantity: number, reason: string, actor: string, idempotencyKey: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('adjust_stock', {
      p_org_id: orgId,
      p_item_id: itemId,
      p_counted_quantity: countedQuantity,
      p_reason: reason,
      p_actor: actor,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    return data as { quantity: number; quantityOnHand: number };
  }

  /** Every change to one item's count, newest first. */
  static async getMovements(orgId: string, itemId: string, limit = 200) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('inventory_movements')
      .select('id, quantity, quantity_after, source_type, source_id, note, created_by, created_at')
      .eq('org_id', orgId)
      .eq('item_id', itemId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(limit);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      quantity: row.quantity,
      quantityAfter: row.quantity_after,
      sourceType: row.source_type,
      sourceId: row.source_id,
      note: row.note,
      createdBy: row.created_by,
      createdAt: row.created_at,
    }));
  }
}
