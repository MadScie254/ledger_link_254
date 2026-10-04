// The accounting controls, end to end through the Worker's services and
// PostgREST: reversals instead of deletes, bill approval, the closing date,
// recorded stock adjustments, and audit rows that name the person who acted.
import assert from 'node:assert/strict';
import test from 'node:test';
import { InvoiceService } from '../../src/server/invoices';
import { BillService } from '../../src/server/bills';
import { LedgerService } from '../../src/server/ledger';
import { AccountService } from '../../src/server/accounts';
import { ReportsService } from '../../src/server/reports';
import { CustomerService } from '../../src/server/customers';
import { InventoryService } from '../../src/server/inventory';
import { OrganizationService } from '../../src/server/organizations';
import { BankingService } from '../../src/server/banking';
import { AuditService } from '../../src/server/audit';
import { runWithRequestContext } from '../../src/server/requestContext';
import { getSupabase } from '../../src/server/supabase';
import { customerUpdateSchema, itemUpdateSchema } from '../../worker/schemas';
import { ORG, OWNER, MEMBER, BANK, AR, AP, SALES, OPEX, CUSTOMER, VENDOR, CEMENT, sql, uuid, refused } from './helpers';

test('a received payment is reversed with a dated entry, and the invoice is owed again', async () => {
  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Cement', accountId: SALES, amountCents: 40_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  const payment = await InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 40_000, paymentDate: '2026-09-10', depositAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER,
  });
  assert.equal((await InvoiceService.getInvoice(ORG, invoiceId))!.status, 'PAID');

  // Payments land only in money accounts.
  await refused(InvoiceService.receivePayment(ORG, invoiceId, {
    amountCents: 1, paymentDate: '2026-09-10', depositAccountId: SALES, idempotencyKey: uuid(), createdBy: OWNER,
  }), /bank, cash or M-Pesa/);

  await refused(InvoiceService.reversePayment(ORG, invoiceId, payment.paymentId, '2026-09-12', '  ', OWNER), /reason/i);
  await InvoiceService.reversePayment(ORG, invoiceId, payment.paymentId, '2026-09-12', 'Cheque bounced', OWNER);

  const invoice = (await InvoiceService.getInvoice(ORG, invoiceId))!;
  assert.equal(invoice.status, 'SENT');
  assert.equal(invoice.amountDueCents, 40_000);
  assert.equal(invoice.payments[0].reversalReason, 'Cheque bounced');
  assert.ok(invoice.payments[0].reversedAt);
  const balances = await AccountService.getAccountBalances(ORG);
  assert.equal(balances.get(BANK) ?? 0, 0, 'the bank is back where it was');
  assert.equal(balances.get(AR), 40_000);

  // A retry (a double click) changes nothing further.
  await InvoiceService.reversePayment(ORG, invoiceId, payment.paymentId, '2026-09-12', 'Cheque bounced', OWNER);
  assert.equal((await InvoiceService.getInvoice(ORG, invoiceId))!.amountDueCents, 40_000);
  assert.equal((await AccountService.getAccountBalances(ORG)).get(BANK) ?? 0, 0);
  // The original payment row stays; history is never rewritten, even with the service key.
  const { error } = await getSupabase().from('invoice_payments').delete().eq('id', payment.paymentId);
  assert.ok(error, 'the delete is refused');
  assert.equal(sql(`SELECT count(*) FROM public.invoice_payments WHERE id = '${payment.paymentId}'`), '1');
});

test('a bill over the approval threshold waits for an admin before it can be paid', async () => {
  await OrganizationService.updateOrganization(ORG, { approvalThresholdCents: 100_000 });
  const billId = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-05', dueDate: '2026-10-05', currency: 'KES', supplierReference: 'KP-778',
    lines: [{ description: 'Generator hire', accountId: OPEX, amountCents: 150_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  await refused(BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-06', dueDate: '2026-10-06', currency: 'KES', supplierReference: 'kp-778',
    lines: [{ description: 'Same invoice again', accountId: OPEX, amountCents: 150_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  }), /already/i);

  const pay = () => BillService.recordPayment(ORG, billId, {
    amountCents: 150_000, paymentDate: '2026-09-20', sourceAccountId: BANK, idempotencyKey: uuid(), createdBy: OWNER,
  });
  await refused(pay(), /approv/i);
  // Whoever entered the bill cannot approve it; another owner or admin can.
  await refused(BillService.approveBill(ORG, billId, OWNER), /cannot also approve/);
  await refused(BillService.approveBill(ORG, billId, MEMBER), /administrator/);
  sql(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${ORG}', '${MEMBER}', 'admin')`);
  await BillService.approveBill(ORG, billId, MEMBER);
  const paid = await pay();
  assert.equal(paid.status, 'PAID');

  await BillService.reversePayment(ORG, billId, paid.paymentId, '2026-09-21', 'Paid the wrong supplier', OWNER);
  const bill = (await BillService.getBill(ORG, billId))!;
  assert.equal(bill.amountDueCents, 150_000);
  assert.equal(bill.supplierReference, 'KP-778');
  assert.ok(bill.approvedAt);
  await OrganizationService.updateOrganization(ORG, { approvalThresholdCents: null });
});

test('nothing posts on or before the closing date', async () => {
  await OrganizationService.updateOrganization(ORG, { booksClosedThrough: '2026-08-31' });
  const entry = (date: string) => LedgerService.postJournalEntry({
    orgId: ORG, entryDate: date, memo: 'Petty cash', sourceType: 'MANUAL', createdBy: OWNER,
    lines: [{ accountId: OPEX, debit: 500, credit: 0 }, { accountId: BANK, debit: 0, credit: 500 }],
  });
  await refused(entry('2026-08-31'), /closed/i);
  await entry('2026-09-01');
  await OrganizationService.updateOrganization(ORG, { booksClosedThrough: null });
});

test('receivables and payables agree with the open documents', async () => {
  const check = await ReportsService.getControlCheck(ORG);
  assert.equal(check.receivables.differenceCents, 0);
  assert.equal(check.payables.differenceCents, 0);
  assert.equal(check.agrees, true);
  assert.equal(check.receivables.ledgerCents, (await AccountService.getAccountBalances(ORG)).get(AR));
  assert.equal(check.payables.ledgerCents, (await AccountService.getAccountBalances(ORG)).get(AP));
});

test('stock counts change only through a recorded adjustment', async () => {
  await refused(InventoryService.updateItem(ORG, CEMENT, { quantityOnHand: 50 }), /stock adjustment/);
  const { error } = await getSupabase().from('inventory_items').update({ quantity_on_hand: 50 }).eq('id', CEMENT);
  assert.match(String(error?.message), /stock adjustment|movement/i);

  const key = uuid();
  const counted = await InventoryService.adjustStock(ORG, CEMENT, 3, 'Two bags damaged by rain', OWNER, key);
  assert.equal(counted.quantity, -2);
  assert.equal(counted.quantityOnHand, 3);
  await InventoryService.adjustStock(ORG, CEMENT, 3, 'Two bags damaged by rain', OWNER, key);
  const movements = await InventoryService.getMovements(ORG, CEMENT);
  assert.deepEqual(movements.map((m) => [m.sourceType, m.quantity, m.quantityAfter]), [['ADJUSTMENT', -2, 3], ['OPENING', 5, 5]]);
  assert.equal(movements[0].note, 'Two bags damaged by rain');
});

test('record changes are audited with the person who made them', async () => {
  const customerId = await runWithRequestContext({ actorId: MEMBER }, () =>
    CustomerService.createCustomer(ORG, { displayName: 'Baraka Hardware' }));
  await runWithRequestContext({ actorId: OWNER }, () =>
    CustomerService.updateCustomer(ORG, customerId, { phone: '0700 000 111' }));

  const { logs } = await AuditService.getLogs(ORG, { resourceType: 'CUSTOMER', resourceId: customerId, includePayroll: false });
  assert.deepEqual(logs.map((l) => [l.action, l.userId]), [['UPDATE', OWNER], ['CREATE', MEMBER]]);
  assert.equal(logs[0].actorEmail, 'owner@test');
  assert.deepEqual(logs[0].details.changes.phone, { from: null, to: '0700 000 111' });

  // Paging walks the whole log without repeats.
  const seen = new Set<string>();
  let cursor: { timestamp: string; id: string } | undefined;
  for (;;) {
    const page = await AuditService.getLogs(ORG, { cursor, limit: 3, includePayroll: false });
    for (const log of page.logs) {
      assert.ok(!seen.has(log.id), 'no row appears on two pages');
      seen.add(log.id);
    }
    if (!page.nextCursor) break;
    const [timestamp, id] = page.nextCursor.split('|');
    cursor = { timestamp, id };
  }
  assert.equal(seen.size, Number(sql(`SELECT count(*) FROM public.audit_logs WHERE org_id = '${ORG}' AND resource_type NOT IN ('EMPLOYEE', 'PAYROLL_RUN')`)));
  await refused(AuditService.getLogs(ORG, { cursor: { timestamp: 'x),id.gt.(0', id: 'nope' }, includePayroll: false }), /not valid/);
});

test('a bank line matched to an account can be unmatched; a payment match is reversed through the payment', async () => {
  const line = uuid();
  sql(`INSERT INTO public.bank_transactions (id, org_id, date, description, amount_cents, direction) VALUES ('${line}', '${ORG}', '2026-09-25', 'BANK CHARGES', 2_500, 'OUT')`);
  await BankingService.matchTransaction(ORG, line, { targetAccountId: OPEX }, OWNER);
  const bankAfterMatch = (await AccountService.getAccountBalances(ORG)).get(BANK) ?? 0;
  await BankingService.unmatchTransaction(ORG, line, OWNER);
  assert.equal((await AccountService.getAccountBalances(ORG)).get(BANK) ?? 0, bankAfterMatch + 2_500);
  // And it can be matched again, to a different account.
  await BankingService.matchTransaction(ORG, line, { targetAccountId: OPEX }, OWNER);

  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Sand', accountId: SALES, amountCents: 9_900 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  const paidLine = uuid();
  sql(`INSERT INTO public.bank_transactions (id, org_id, date, description, amount_cents, direction) VALUES ('${paidLine}', '${ORG}', '2026-09-26', 'MPESA SAND', 9_900, 'IN')`);
  await BankingService.matchTransaction(ORG, paidLine, { invoiceId }, OWNER);
  await refused(BankingService.unmatchTransaction(ORG, paidLine, OWNER), /Reverse that payment/);
});

test('a new organization is created with its owner and chart in one step, once per key', async () => {
  const key = uuid();
  const input = { name: 'Second Shop', baseCurrency: 'KES', country: 'Kenya', creationKey: key };
  const first = await OrganizationService.createOrganization(input, MEMBER);
  assert.equal(await OrganizationService.createOrganization(input, MEMBER), first);
  const accounts = await AccountService.getAccounts(first);
  assert.ok(accounts.some((a) => a.code === '1000' && a.isBankAccount));
  assert.ok(!accounts.some((a) => a.code === '1100' && a.isBankAccount));
  assert.equal(sql(`SELECT role FROM public.memberships WHERE org_id = '${first}' AND user_id = '${MEMBER}'`), 'owner');
});

test('an edit changes only the fields sent, and null clears a field', async () => {
  const id = await CustomerService.createCustomer(ORG, { displayName: 'Kisumu Traders', phone: '0711 000 000', email: 'pay@kisumu.example' });
  const body = customerUpdateSchema.parse({ displayName: 'Kisumu Traders Ltd', phone: null, unknownField: 'dropped' });
  assert.deepEqual(body, { displayName: 'Kisumu Traders Ltd', phone: null });
  await CustomerService.updateCustomer(ORG, id, body as any);
  const [phone, email, name] = sql(`SELECT coalesce(phone, '(none)') || '|' || email || '|' || display_name FROM public.customers WHERE id = '${id}'`).split('|');
  assert.deepEqual([phone, email, name], ['(none)', 'pay@kisumu.example', 'Kisumu Traders Ltd']);
  assert.throws(() => customerUpdateSchema.parse({ displayName: null }));
  assert.throws(() => itemUpdateSchema.parse({ itemType: null }));
});

test('a bill line for a stock item counts it in, and voiding the bill counts it out', async () => {
  const DELIVERY_ITEM = '00000000-0000-0000-0000-0000000000e2';
  const before = Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE id = '${CEMENT}'`));
  const billId = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-20', dueDate: '2026-10-20', currency: 'KES', idempotencyKey: uuid(), createdBy: OWNER,
    lines: [
      { description: 'Cement 50kg', accountId: OPEX, amountCents: 72_000 * 4, inventoryItemId: CEMENT, quantity: 4 },
      { description: 'Delivery', accountId: OPEX, amountCents: 5_000, inventoryItemId: DELIVERY_ITEM, quantity: 1.5 },
    ],
  });
  assert.equal(Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE id = '${CEMENT}'`)), before + 4);
  assert.equal(sql(`SELECT cost_price_cents FROM public.inventory_items WHERE id = '${CEMENT}'`), '72000');
  assert.equal(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE id = '${DELIVERY_ITEM}'`), '0', 'services are not counted');
  const bill = (await BillService.getBill(ORG, billId))!;
  assert.deepEqual(bill.lines.map((l: any) => [l.inventoryItemId, l.quantity]), [[CEMENT, 4], [DELIVERY_ITEM, 1.5]]);

  await BillService.voidBill(ORG, billId, OWNER, '2026-09-21');
  assert.equal(Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE id = '${CEMENT}'`)), before);
  assert.equal(sql(`SELECT string_agg(quantity::text, ',' ORDER BY created_at) FROM public.inventory_movements WHERE source_type = 'BILL' AND source_id = '${billId}'`), '4,-4');

  await refused(BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-20', dueDate: '2026-10-20', currency: 'KES', idempotencyKey: uuid(), createdBy: OWNER,
    lines: [{ description: 'Half a bag', accountId: OPEX, amountCents: 36_000, inventoryItemId: CEMENT, quantity: 0.5 }],
  }), /whole units/);
});

import { CashTransactionService } from '../../src/server/cashTransactions';

test('a sales receipt, an expense and a transfer post, list with their names, and void', async () => {
  sql(`UPDATE public.organizations SET books_closed_through = NULL WHERE id = '${ORG}'`);
  const till = sql(`INSERT INTO public.accounts (org_id, code, name, type, is_bank_account) VALUES ('${ORG}', '1050', 'M-Pesa Till', 'ASSET', true) RETURNING id`).split('\n')[0];
  const receipt = await CashTransactionService.recordSalesReceipt({
    orgId: ORG, payeeName: 'Walk-in', date: '2026-09-15', depositAccountId: till, reference: 'QJK7', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Cement 50kg', accountId: SALES, inventoryItemId: CEMENT, quantity: 1, unitPriceCents: 75_000, taxRate: 16 }],
  });
  const expense = await CashTransactionService.recordExpense({
    orgId: ORG, vendorId: VENDOR, date: '2026-09-16', paidFromAccountId: BANK, actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Tokens', accountId: OPEX, amountCents: 10_000, taxCents: 1_600 }],
  });
  const transfer = await CashTransactionService.recordTransfer({
    orgId: ORG, date: '2026-09-17', fromAccountId: till, toAccountId: BANK, amountCents: 50_000, memo: 'Banking the till', actor: OWNER, idempotencyKey: uuid(),
  });
  assert.match(receipt.number, /^SR-2026-/);
  assert.match(expense.number, /^EXP-2026-/);
  assert.match(transfer.number, /^TRF-2026-/);

  const all = await CashTransactionService.list(ORG);
  const byId = new Map(all.map((t) => [t.id, t]));
  assert.equal(byId.get(receipt.id)!.partyName, 'Walk-in');
  assert.equal(byId.get(receipt.id)!.moneyAccountName, '1050 M-Pesa Till');
  assert.equal(byId.get(receipt.id)!.lines[0].quantity, 1);
  assert.equal(byId.get(expense.id)!.partyName, 'Kenya Power');
  assert.equal(byId.get(transfer.id)!.toAccountName, '1000 Bank');
  assert.deepEqual((await CashTransactionService.list(ORG, 'EXPENSE')).map((t) => t.id), [expense.id]);

  await CashTransactionService.void(ORG, receipt.id, '2026-09-18', 'Rang up twice', OWNER);
  assert.equal((await CashTransactionService.list(ORG, 'SALES_RECEIPT'))[0].status, 'VOID');
  await refused(CashTransactionService.void(ORG, expense.id, '2026-09-10', 'Before it happened', OWNER), /on or after/);
});

import { CreditNoteService } from '../../src/server/creditNotes';
import { partyBalances } from '../../src/server/partyBalances';

test('a credit note lowers an invoice, an unused credit nets the balance, and refunds and voids post', async () => {
  sql(`UPDATE public.organizations SET books_closed_through = NULL WHERE id = '${ORG}'`);
  const invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Cement', accountId: SALES, amountCents: 150_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  const before = Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE id = '${CEMENT}'`));
  const credit = await CreditNoteService.issueCustomerCredit({
    orgId: ORG, customerId: CUSTOMER, invoiceId, date: '2026-09-03', memo: 'Bag split', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Cement returned', accountId: SALES, inventoryItemId: CEMENT, quantity: 1, unitPriceCents: 75_000, taxRate: 0 }],
  });
  assert.match(credit.number, /^CN-2026-/);
  assert.equal(credit.appliedCents, 75_000);
  assert.equal((await InvoiceService.getInvoice(ORG, invoiceId))!.amountDueCents, 75_000);
  assert.equal(Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE id = '${CEMENT}'`)), before + 1);

  const goodwill = await CreditNoteService.issueCustomerCredit({
    orgId: ORG, customerId: CUSTOMER, date: '2026-09-04', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Late delivery', accountId: SALES, quantity: 1, unitPriceCents: 20_000, taxRate: 0 }],
  });
  const listed = await CreditNoteService.list(ORG, { kind: 'CUSTOMER' });
  const first = listed.find((c) => c.id === credit.id)!;
  assert.equal(first.partyName, 'Acme');
  assert.equal(first.invoiceNumber, (await InvoiceService.getInvoice(ORG, invoiceId))!.invoiceNumber);
  assert.equal(first.status, 'CLOSED');
  assert.equal(first.uses[0].kind, 'APPLY');
  assert.equal(first.uses[0].documentNumber, first.invoiceNumber);

  // The unused credit counts against what the customer owes, and the ledger still agrees.
  const balance = (await partyBalances(ORG, 'CUSTOMER')).get(CUSTOMER)!;
  const openDue = Number(sql(`SELECT sum(amount_due_cents) FROM public.invoices WHERE customer_id = '${CUSTOMER}' AND status NOT IN ('PAID', 'VOID')`));
  assert.equal(balance.openCents, openDue - 20_000);
  assert.equal((await ReportsService.getControlCheck(ORG)).agrees, true);
  const aging = await ReportsService.getARAging(ORG);
  assert.ok(aging.rows.some((r: any) => r.referenceNo === goodwill.number && r.amountDueCents === -20_000), 'unused credit in the aging');

  const refund = await CreditNoteService.refund({
    orgId: ORG, creditId: goodwill.id, amountCents: 20_000, date: '2026-09-05', moneyAccountId: BANK, reference: 'QX1', actor: OWNER, idempotencyKey: uuid(),
  });
  assert.match(refund.number, /^RF-2026-/);
  assert.equal(refund.remainingCents, 0);
  const refunded = (await CreditNoteService.list(ORG, { customerId: CUSTOMER })).find((c) => c.id === goodwill.id)!;
  assert.equal(refunded.uses[0].moneyAccountName, '1000 Bank');
  await refused(CreditNoteService.void(ORG, goodwill.id, '2026-09-06', 'Issued in error', OWNER), /Undo those first/);
  await refused(CreditNoteService.reverseUse(ORG, refunded.uses[0].id, '2026-09-06', ' ', OWNER), /reason/i);
  await CreditNoteService.reverseUse(ORG, refunded.uses[0].id, '2026-09-06', 'Sent to the wrong number', OWNER);
  await CreditNoteService.void(ORG, goodwill.id, '2026-09-06', 'Issued in error', OWNER);
  assert.equal((await CreditNoteService.list(ORG, { kind: 'CUSTOMER' })).find((c) => c.id === goodwill.id)!.status, 'VOID');

  // A supplier credit applied later to a bill.
  const billId = await BillService.createBill({
    orgId: ORG, vendorId: VENDOR, billDate: '2026-09-02', dueDate: '2026-10-02', currency: 'KES', idempotencyKey: uuid(), createdBy: OWNER,
    lines: [{ description: 'Generator service', accountId: OPEX, amountCents: 30_000 }],
  });
  const supplierCredit = await CreditNoteService.recordSupplierCredit({
    orgId: ORG, vendorId: VENDOR, date: '2026-09-04', reference: 'KPLC-CR-1', actor: OWNER, idempotencyKey: uuid(),
    lines: [{ description: 'Overcharge', accountId: OPEX, amountCents: 5_000 }],
  });
  assert.match(supplierCredit.number, /^SC-2026-/);
  await refused(CreditNoteService.apply({
    orgId: ORG, creditId: supplierCredit.id, documentId: billId, amountCents: 6_000, date: '2026-09-05', actor: OWNER, idempotencyKey: uuid(),
  }), /no more than that/);
  const applied = await CreditNoteService.apply({
    orgId: ORG, creditId: supplierCredit.id, documentId: billId, amountCents: 5_000, date: '2026-09-05', actor: OWNER, idempotencyKey: uuid(),
  });
  assert.equal(applied.amountDueCents, 25_000);
  assert.equal((await CreditNoteService.list(ORG, { vendorId: VENDOR }))[0].uses[0].documentNumber,
    (await BillService.getBill(ORG, billId))!.billNumber);
  assert.equal((await ReportsService.getControlCheck(ORG)).agrees, true);

  // A read-only member cannot post a credit; the database refuses as well as the Worker.
  const reader = uuid();
  sql(`INSERT INTO auth.users (id, email) VALUES ('${reader}', 'reader@example.com')`);
  sql(`INSERT INTO public.memberships (org_id, user_id, role) VALUES ('${ORG}', '${reader}', 'member')`);
  await refused(CreditNoteService.issueCustomerCredit({
    orgId: ORG, customerId: CUSTOMER, date: '2026-09-04', actor: reader, idempotencyKey: uuid(),
    lines: [{ description: 'x', accountId: SALES, quantity: 1, unitPriceCents: 100, taxRate: 0 }],
  }), /owner|administrator|accountant|permission|not allowed|cannot/i);
});

import { BusinessReportService } from '../../src/server/businessReports';

test('a customer statement runs from the ledger and closes on what is owed; sales and spending reports add up', async () => {
  const statement = await BusinessReportService.partyStatement(ORG, 'CUSTOMER', CUSTOMER, '2026-01-01', '2026-12-31');
  assert.equal(statement.party.name, 'Acme');
  assert.equal(statement.openingBalanceCents, 0);
  const owed = (await partyBalances(ORG, 'CUSTOMER')).get(CUSTOMER)!.openCents;
  assert.equal(statement.closingBalanceCents, owed, 'closes on the open balance');
  assert.ok(statement.lines.some((l) => l.kind === 'Credit note' && l.creditCents > 0));
  assert.ok(statement.lines.some((l) => l.kind === 'Refund' && l.chargeCents > 0));
  const last = statement.lines[statement.lines.length - 1];
  assert.equal(last.balanceCents, statement.closingBalanceCents);
  await refused(BusinessReportService.partyStatement(ORG, 'CUSTOMER', CUSTOMER, '2026-12-31', '2026-01-01'), /cannot be before/);

  const supplier = await BusinessReportService.partyStatement(ORG, 'VENDOR', VENDOR, '2026-01-01', '2026-12-31');
  assert.equal(supplier.closingBalanceCents, (await partyBalances(ORG, 'VENDOR')).get(VENDOR)!.openCents);

  const sales = await BusinessReportService.salesByCustomer(ORG, 'Last Year');
  assert.deepEqual(sales.rows, []);
  const year = await BusinessReportService.salesByCustomer(ORG, '2026-09');
  assert.equal(year.totalCents, year.rows.reduce((sum, r) => sum + r.invoicedCents + r.cashSalesCents - r.creditedCents, 0));
  const items = await BusinessReportService.salesByItem(ORG, '2026-09');
  assert.equal(items.totalCents, items.rows.reduce((sum, r) => sum + r.amountCents, 0));
  const spending = await BusinessReportService.expensesBySupplier(ORG, '2026-09');
  assert.ok(spending.rows.some((r) => r.name === 'Kenya Power' && r.netCents > 0));

  const monthly = await BusinessReportService.monthlyProfitAndLoss(ORG, 'Q3 2026');
  assert.deepEqual(monthly.months, ['2026-07', '2026-08', '2026-09']);
  const pnl = await ReportsService.getProfitAndLoss(ORG, 'Q3 2026');
  const sum = (rows: Array<{ amountCents: number }>) => rows.reduce((total, r) => total + r.amountCents, 0);
  assert.equal(monthly.income.totalCents, sum(pnl.income), 'income agrees with the profit and loss');
  assert.equal(monthly.netTotalCents, sum(pnl.income) - sum(pnl.costOfSales) - sum(pnl.expenses), 'net agrees with the profit and loss');
  assert.equal(monthly.netMonths.reduce((a, b) => a + b, 0), monthly.netTotalCents);
});
