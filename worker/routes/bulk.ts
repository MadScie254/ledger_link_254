import { getSupabase } from '../../src/server/supabase';
import { InvoiceService } from '../../src/server/invoices';
import { BillService } from '../../src/server/bills';
import { organizationToday } from '../../src/server/organizationDates';
import { publicMessage } from '../../src/server/publicMessage';
import { bodyOf, respondError } from '../http';
import { bulkDeleteSchema, bulkStatusUpdateSchema } from '../schemas';
import type { Api } from './types';

// Customers, suppliers, stock items and employees are deleted outright (the
// database refuses any still in use and records each deletion in the audit
// log); invoices and bills are voided with a reversing entry, never deleted.
const BULK_TABLES = {
  CUSTOMERS: 'customers',
  VENDORS: 'vendors',
  INVENTORY: 'inventory_items',
  EMPLOYEES: 'employees',
} as const;

export function registerBulkRoutes(api: Api) {
  api.post('/bulk/delete', async (c) => {
    try {
      const orgId = c.get('orgId');
      const userId = c.get('userId');
      const { entityType, ids } = bulkDeleteSchema.parse(await bodyOf(c));
      if (entityType === 'EMPLOYEES' && c.get('orgRole') === 'member') {
        return c.json({ error: 'Payroll and employee records are open to the owner, administrators and accountants only.' }, 403);
      }

      if (entityType === 'INVOICES' || entityType === 'BILLS') {
        // Each void is its own transaction. One that is refused (for example
        // an invoice with payments) does not stop the rest; each refusal is
        // reported with its document.
        const voidDate = await organizationToday(orgId);
        const failures: Array<{ id: string; message: string }> = [];
        for (const id of ids) {
          try {
            if (entityType === 'INVOICES') await InvoiceService.voidInvoice(orgId, id, userId, voidDate);
            else await BillService.voidBill(orgId, id, userId, voidDate);
          } catch (err) {
            failures.push({ id, message: publicMessage(err) });
          }
        }
        return c.json({ success: failures.length === 0, count: ids.length - failures.length, failed: failures.length, failures, action: 'VOID' });
      }

      const supabase = getSupabase();
      const { data: deleted, error } = await supabase
        .from(BULK_TABLES[entityType])
        .delete()
        .eq('org_id', orgId)
        .in('id', ids)
        .select('id');
      if (error) throw error;
      return c.json({ success: true, count: deleted?.length || 0, action: 'DELETE' });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/bulk/status-update', async (c) => {
    try {
      const orgId = c.get('orgId');
      const { entityType, ids, status } = bulkStatusUpdateSchema.parse(await bodyOf(c));
      if (entityType === 'EMPLOYEES' && c.get('orgRole') === 'member') {
        return c.json({ error: 'Payroll and employee records are open to the owner, administrators and accountants only.' }, 403);
      }
      // Customers and suppliers carry an active flag; stock items and
      // employees a status. Either way an inactive record keeps its history.
      const values = entityType === 'CUSTOMERS' || entityType === 'VENDORS'
        ? { is_active: status === 'ACTIVE' }
        : { status: status === 'ACTIVE' ? 'Active' : 'Inactive' };

      const supabase = getSupabase();
      const { data: updated, error } = await supabase
        .from(BULK_TABLES[entityType])
        .update(values)
        .eq('org_id', orgId)
        .in('id', ids)
        .select('id');
      if (error) throw error;
      return c.json({ success: true, count: updated?.length || 0 });
    } catch (err) { return respondError(c, err); }
  });
}
