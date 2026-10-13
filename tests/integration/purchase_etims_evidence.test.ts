import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { BillService } from '../../src/server/bills';
import { CashTransactionService } from '../../src/server/cashTransactions';
import { BusinessReportService } from '../../src/server/businessReports';
import { PurchaseEvidenceService } from '../../src/server/purchaseEvidence';
import { registerCashRoutes } from '../../worker/routes/cash';
import { BANK, OPEX, ORG, OWNER, VENDOR, uuid, refused } from './helpers';

test('purchase evidence posts atomically, can be corrected, and changes the VAT risk report', async () => {
  const billId = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-10', dueDate: '2026-10-10',
    supplierReference: 'SUP-ETIMS-1', currency: 'KES', lines: [
      { description: 'Supplies', accountId: OPEX, amountCents: 10_000, taxCents: 1_600 },
    ], idempotencyKey: uuid(), createdBy: OWNER,
  });
  const expense = await CashTransactionService.recordExpense({
    orgId: ORG, vendorId: VENDOR, date: '2026-09-11', paidFromAccountId: BANK,
    lines: [{ description: 'Stationery', accountId: OPEX, amountCents: 5_000, taxCents: 800 }],
    etimsInvoiceNumber: 'CU-902', etimsInvoiceDate: '2026-09-11',
    actor: OWNER, idempotencyKey: uuid(),
  });
  assert.equal((await BillService.getBill(ORG, billId))?.etimsInvoiceNumber, null);
  assert.equal((await CashTransactionService.list(ORG, 'EXPENSE')).find((row) => row.id === expense.id)?.etimsInvoiceNumber, 'CU-902');
  const atRisk = await BusinessReportService.inputVatAtRisk(ORG, 'September 2026');
  assert.equal(atRisk.totalCents, 1_600);
  assert.equal(atRisk.rows[0].billCount, 1);
  assert.equal(atRisk.rows[0].expenseCount, 0);
  await PurchaseEvidenceService.set(ORG, 'BILL', billId, OWNER, { etimsExemptionReason: 'Exempt supply' });
  assert.equal((await BillService.getBill(ORG, billId))?.etimsExemptionReason, 'Exempt supply');
  assert.equal((await BusinessReportService.inputVatAtRisk(ORG, 'September 2026')).totalCents, 0);
  await refused(PurchaseEvidenceService.set('00000000-0000-0000-0000-0000000000bb', 'BILL', billId, OWNER,
    { etimsInvoiceNumber: 'CU-999', etimsInvoiceDate: '2026-09-10' }), /owner|organization/i);
});

test('the expense evidence route rejects a CU number without a date', async () => {
  const api = new Hono<any>();
  api.use('*', async (c, next) => { c.set('orgId', ORG); c.set('userId', OWNER); await next(); });
  registerCashRoutes(api);
  const response = await api.request(`/expenses/${uuid()}/etims-evidence`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ etimsInvoiceNumber: 'CU-1' }),
  });
  assert.equal(response.status, 400);
});
