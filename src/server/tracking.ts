import { getSupabase } from './supabase';
import { organizationNow } from './organizationDates';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import { resolveReportDateRange } from '../utils/reportCalculations';

export type TagKind = 'CLASS' | 'LOCATION';

const NOUN: Record<TagKind, string> = { CLASS: 'class', LOCATION: 'location' };

function mapTag(row: any) {
  return { id: row.id, kind: row.kind as TagKind, name: row.name, isActive: row.is_active !== false, createdAt: row.created_at };
}

/**
 * Classes and locations: the lists, and the profit and loss cut by them.
 * Postings are tagged by the request headers (see requestContext), so no
 * posting function needs to know about them.
 */
export class TrackingService {
  static async list(orgId: string) {
    const { data, error } = await getSupabase()
      .from('tracking_categories')
      .select('*')
      .eq('org_id', orgId)
      .order('kind')
      .order('name');
    if (error) throw error;
    return (data || []).map(mapTag);
  }

  static async create(orgId: string, kind: TagKind, name: string, actor: string) {
    const { data, error } = await getSupabase()
      .from('tracking_categories')
      .insert({ org_id: orgId, kind, name: name.trim(), created_by: actor })
      .select('*')
      .single();
    if (error?.code === '23505') throw new UserError(`There is already a ${NOUN[kind]} called ${name.trim()}.`, 409);
    if (error) throw error;
    return mapTag(data);
  }

  static async update(orgId: string, id: string, input: { name?: string; isActive?: boolean }) {
    const values: Record<string, unknown> = {};
    if (input.name !== undefined) values.name = input.name.trim();
    if (input.isActive !== undefined) values.is_active = input.isActive;
    if (Object.keys(values).length === 0) throw new UserError('Nothing to change.');
    const { data, error } = await getSupabase()
      .from('tracking_categories')
      .update(values)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error?.code === '23505') throw new UserError(`That name is already in use.`, 409);
    if (error) throw error;
    if (!data) throw new UserError('Not found in this organization.', 404);
    return mapTag(data);
  }

  /** Income, cost of sales and expenses by account, a column for each class or location. */
  static async profitAndLossByTag(orgId: string, kind: TagKind, dateRange: string) {
    const range = resolveReportDateRange(dateRange, await organizationNow(orgId));
    const supabase = getSupabase();
    const [{ data: totals, error }, tags, accounts] = await Promise.all([
      supabase.rpc('profit_and_loss_by_tag', { p_org_id: orgId, p_kind: kind, p_from: range.start, p_to: range.end }),
      this.list(orgId),
      fetchAllRows<{ id: string; code: string | null; name: string | null; type: string }>((f, t) => supabase
        .from('accounts').select('id, code, name, type').eq('org_id', orgId).order('id').range(f, t)),
    ]);
    if (error) throw error;
    const rows = (totals || []) as Array<{ tag_id: string | null; account_id: string; debit_cents: number; credit_cents: number }>;
    const used = new Set(rows.map((r) => r.tag_id));
    const columns = [
      ...tags.filter((t) => t.kind === kind && (t.isActive || used.has(t.id))).map((t) => ({ id: t.id as string | null, name: t.name })),
      { id: null, name: kind === 'CLASS' ? 'No class' : 'No location' },
    ];
    const index = new Map(columns.map((c, i) => [c.id, i]));
    const byAccount = new Map(accounts.map((a) => [a.id, a]));
    const lines = new Map<string, { accountId: string; code: string; name: string; type: string; amounts: number[]; totalCents: number }>();
    for (const row of rows) {
      const account = byAccount.get(row.account_id);
      const column = index.get(row.tag_id);
      if (!account || column === undefined) continue;
      const amount = Math.round(account.type === 'INCOME'
        ? (Number(row.credit_cents) || 0) - (Number(row.debit_cents) || 0)
        : (Number(row.debit_cents) || 0) - (Number(row.credit_cents) || 0));
      const line = lines.get(account.id) || { accountId: account.id, code: account.code || '', name: account.name || '', type: account.type, amounts: columns.map(() => 0), totalCents: 0 };
      line.amounts[column] += amount;
      line.totalCents += amount;
      lines.set(account.id, line);
    }
    const sorted = [...lines.values()].sort((a, b) => a.code.localeCompare(b.code));
    const section = (type: string) => {
      const sectionRows = sorted.filter((l) => l.type === type);
      return {
        rows: sectionRows,
        amounts: columns.map((_, i) => sectionRows.reduce((sum, r) => sum + r.amounts[i], 0)),
        totalCents: sectionRows.reduce((sum, r) => sum + r.totalCents, 0),
      };
    };
    const income = section('INCOME');
    const costOfSales = section('COGS');
    const expenses = section('EXPENSE');
    return {
      range,
      kind,
      columns,
      income,
      costOfSales,
      expenses,
      net: columns.map((_, i) => income.amounts[i] - costOfSales.amounts[i] - expenses.amounts[i]),
      netTotalCents: income.totalCents - costOfSales.totalCents - expenses.totalCents,
    };
  }
}
