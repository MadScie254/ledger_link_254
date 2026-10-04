import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { customerRow, type CustomerInput } from './customers';
import { vendorRow, type VendorInput } from './vendors';
import { itemRow, type ItemInput } from './inventory';

export type ImportKind = 'CUSTOMER' | 'VENDOR' | 'ITEM';

const TABLES: Record<ImportKind, { table: string; nameColumn: string; noun: string }> = {
  CUSTOMER: { table: 'customers', nameColumn: 'display_name', noun: 'customer' },
  VENDOR: { table: 'vendors', nameColumn: 'display_name', noun: 'supplier' },
  ITEM: { table: 'inventory_items', nameColumn: 'name', noun: 'stock item' },
};

const key = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Adds customers, suppliers or stock items from a spreadsheet. Rows have
 * already been checked one by one against the same rules as the forms; here
 * a name the organization already has, or one repeated in the file, is
 * skipped, and the rest are added in one statement, so either all of them
 * are added or none. Each added row is audited as if entered by hand.
 */
export class RecordImportService {
  static async importRecords(
    orgId: string,
    kind: ImportKind,
    rows: Array<{ row: number; input: CustomerInput | VendorInput | ItemInput }>,
  ) {
    const { table, nameColumn, noun } = TABLES[kind];
    const supabase = getSupabase();
    const columns: string = `id, ${nameColumn}`;
    const existing = await fetchAllRows<any>((from, to) => supabase
      .from(table)
      .select(columns)
      .eq('org_id', orgId)
      .order('id')
      .range(from, to) as any);
    const taken = new Set(existing.map((row) => key(String(row[nameColumn] || ''))));

    const skipped: Array<{ row: number; name: string; reason: string }> = [];
    const toAdd: Array<Record<string, unknown>> = [];
    for (const { row, input } of rows) {
      const name = String((input as any).displayName ?? (input as any).name ?? '');
      if (taken.has(key(name))) {
        skipped.push({ row, name, reason: `a ${noun} with this name is already in the books, or earlier in the file` });
        continue;
      }
      taken.add(key(name));
      toAdd.push(kind === 'CUSTOMER'
        ? customerRow(orgId, input as CustomerInput)
        : kind === 'VENDOR'
          ? vendorRow(orgId, input as VendorInput)
          : itemRow(orgId, input as ItemInput));
    }

    if (toAdd.length > 0) {
      const { error } = await supabase.from(table).insert(toAdd);
      if (error) throw error;
    }
    return { imported: toAdd.length, skipped };
  }
}
