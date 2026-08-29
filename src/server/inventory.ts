import { getSupabase } from './supabase';

export class InventoryService {
  static async getItems(orgId: string) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('org_id', orgId)
      .order('name');
      
    if (error) throw error;
    
    return (data || []).map(row => ({
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      sku: row.sku,
      description: row.description,
      category: row.category,
      type: row.type,
      quantityOnHand: row.quantity_on_hand,
      reorderPoint: row.reorder_point,
      unitPriceCents: row.unit_price_cents,
      costPriceCents: row.cost_price_cents,
      incomeAccountId: row.income_account_id,
      cogsAccountId: row.cogs_account_id,
      assetAccountId: row.asset_account_id,
      status: row.status,
      createdAt: row.created_at
    }));
  }

  static async createItem(orgId: string, input: any) {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('inventory_items')
      .insert({
        org_id: orgId,
        name: input.name,
        type: input.itemType || 'Physical Product',
        sku: input.sku || null,
        category: input.category || 'General',
        description: input.description || null,
        unit_price_cents: input.priceCents || 0,
        cost_price_cents: input.costCents || 0,
        income_account_id: input.incomeAccountId || null,
        cogs_account_id: input.expenseAccountId || null,
        quantity_on_hand: input.quantityOnHand || 0,
        reorder_point: input.reorderPoint || 0,
        status: 'Active'
      })
      .select('id')
      .single();
      
    if (error) throw error;
    return data.id;
  }

  static async updateItem(orgId: string, id: string, input: any) {
    const supabase = getSupabase();
    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.itemType !== undefined) updateData.type = input.itemType;
    if (input.sku !== undefined) updateData.sku = input.sku;
    if (input.category !== undefined) updateData.category = input.category;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.priceCents !== undefined) updateData.unit_price_cents = input.priceCents;
    if (input.costCents !== undefined) updateData.cost_price_cents = input.costCents;
    if (input.incomeAccountId !== undefined) updateData.income_account_id = input.incomeAccountId;
    if (input.expenseAccountId !== undefined) updateData.cogs_account_id = input.expenseAccountId;
    if (input.quantityOnHand !== undefined) updateData.quantity_on_hand = input.quantityOnHand;
    if (input.reorderPoint !== undefined) updateData.reorder_point = input.reorderPoint;

    const { error } = await supabase
      .from('inventory_items')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId);
      
    if (error) throw error;
  }
}
