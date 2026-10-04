import type { ZodTypeAny } from 'zod';
import { RecordImportService, type ImportKind } from '../../src/server/recordImports';
import { bodyOf, respondError, UserError } from '../http';
import { customerSchema, itemSchema, recordImportSchema, vendorSchema } from '../schemas';
import type { Api } from './types';

const KINDS: Record<string, { kind: ImportKind; schema: ZodTypeAny }> = {
  customers: { kind: 'CUSTOMER', schema: customerSchema },
  vendors: { kind: 'VENDOR', schema: vendorSchema },
  items: { kind: 'ITEM', schema: itemSchema },
};

const FIELD_LABELS: Record<string, string> = {
  displayName: 'name', name: 'name', email: 'email', phone: 'phone', kraPin: 'KRA PIN',
  priceCents: 'price', costCents: 'cost', quantityOnHand: 'quantity on hand', taxRate: 'VAT rate',
  creditLimitCents: 'credit limit', reorderPoint: 'reorder point',
};

/**
 * Customers, suppliers and stock items from a spreadsheet. Every row is
 * checked by the same rules as the form that adds one. With any row wrong,
 * nothing is added and each problem is listed, unless the caller asks to
 * skip those rows.
 */
export function registerImportRoutes(api: Api) {
  api.post('/imports/:kind', async (c) => {
    try {
      const target = KINDS[c.req.param('kind')];
      if (!target) throw new UserError('Customers, suppliers or stock items can be imported.');
      const body = recordImportSchema.parse(await bodyOf(c));
      const valid: Array<{ row: number; input: any }> = [];
      const problems: Array<{ row: number; reason: string }> = [];
      for (const { row, values } of body.rows) {
        const parsed = target.schema.safeParse(values);
        if (parsed.success) {
          valid.push({ row, input: parsed.data });
        } else {
          const issue = parsed.error.issues[0];
          const field = String(issue.path[0] ?? '');
          problems.push({ row, reason: `${FIELD_LABELS[field] || field || 'row'}: ${issue.message}` });
        }
      }
      if (problems.length > 0 && !body.skipInvalid) {
        return c.json({ error: `${problems.length} ${problems.length === 1 ? 'row has a problem' : 'rows have problems'}; nothing was added.`, problems }, 422);
      }
      const result = await RecordImportService.importRecords(c.get('orgId'), target.kind, valid);
      return c.json({ ...result, problems }, 201);
    } catch (err) { return respondError(c, err); }
  });
}
