// Money in and out at once: sales receipts, expenses and transfers, from
// their screens against the real API.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { signedIn, openView, refusedWrites, closeBrowser, sql, flow } from './helpers.mjs';

after(closeBrowser);

test('a walk-in sale is posted on a sales receipt into the till', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('sales-receipt', session, async () => {
    const before = Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE name = 'Cement 50kg'`));
    await openView(page, 'Sales');
    await page.getByRole('tab', { name: /Sales receipts/ }).click();
    await page.getByRole('button', { name: 'New sales receipt' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Line 1 stock item').selectOption({ label: 'Cement 50kg' });
    await dialog.getByLabel('Line 1 quantity').fill('1');
    await dialog.getByLabel('Line 1 VAT rate').fill('16');
    await dialog.locator('select').filter({ hasText: '1050 · M-Pesa Till' }).selectOption({ label: '1050 · M-Pesa Till' });
    await dialog.getByRole('button', { name: 'Post sales receipt' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByText(/SR-\d{4}-00001/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT kind || ' ' || total_cents FROM public.cash_transactions WHERE kind = 'SALES_RECEIPT'`), 'SALES_RECEIPT 87000');
    assert.equal(Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE name = 'Cement 50kg'`)), before - 1);
    assert.deepEqual(problems, []);
  });
});

test('an expense paid from the bank is posted', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('expense', session, async () => {
    await openView(page, 'Bills and expenses');
    await page.getByRole('tab', { name: 'Expenses' }).click();
    await page.getByRole('button', { name: 'New expense' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[name="payeeName"]').fill('Naivas Supermarket');
    await dialog.locator('select[name="paidFromAccountId"]').selectOption({ label: '1000 · Bank' });
    await dialog.getByLabel('Line 1 particulars').fill('Cleaning supplies');
    await dialog.getByLabel('Line 1 account').selectOption({ label: '6000 · Operating expenses' });
    await dialog.getByLabel('Line 1 amount').fill('2,500');
    await dialog.getByLabel('Line 1 VAT percentage').fill('16');
    await dialog.getByRole('button', { name: 'Post expense' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByText(/EXP-\d{4}-00001/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT payee_name || ' ' || total_cents FROM public.cash_transactions WHERE kind = 'EXPENSE'`), 'Naivas Supermarket 290000');
    assert.deepEqual(problems, []);
  });
});

test('a receipt PDF is attached to an expense and downloaded again', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('attachment', session, async () => {
    await openView(page, 'Bills and expenses');
    await page.getByRole('tab', { name: 'Expenses' }).click();
    await page.getByRole('button', { name: 'Files' }).first().click();
    const dialog = page.getByRole('dialog');
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    await dialog.locator('input[name="attachment"]').setInputFiles({ name: 'naivas-receipt.pdf', mimeType: 'application/pdf', buffer: pdf });
    await dialog.getByRole('button', { name: 'naivas-receipt.pdf', exact: true }).waitFor({ timeout: 10_000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      dialog.getByRole('button', { name: 'naivas-receipt.pdf', exact: true }).click(),
    ]);
    assert.equal(download.suggestedFilename(), 'naivas-receipt.pdf');
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT record_type || ' ' || content_type FROM public.attachments WHERE file_name = 'naivas-receipt.pdf'`), 'CASH_TRANSACTION application/pdf');
    assert.deepEqual(problems, []);
  });
});

test('money is transferred from the till to the bank, then the transfer voided', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('transfer', session, async () => {
    await openView(page, 'Banking');
    await page.getByRole('button', { name: 'Transfer money' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select[name="fromAccountId"]').selectOption({ label: '1050 · M-Pesa Till' });
    await dialog.locator('select[name="toAccountId"]').selectOption({ label: '1000 · Bank' });
    await dialog.locator('input[name="amount"]').fill('500');
    await dialog.getByRole('button', { name: 'Post transfer' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByRole('tab', { name: 'Transfers' }).click();
    await page.getByRole('button', { name: 'Void' }).click();
    const voiding = page.getByRole('dialog');
    await voiding.getByLabel('Reason').fill('Wrong account');
    await voiding.getByRole('button', { name: 'Void', exact: true }).click();
    await page.getByText(/voided on/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT status || ' ' || void_reason FROM public.cash_transactions WHERE kind = 'TRANSFER'`), 'VOID Wrong account');
    assert.deepEqual(problems, []);
  });
});

test('a credit note is issued against an invoice and lowers what is due', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('credit-note', session, async () => {
    const invoiceId = sql(`SELECT public.create_invoice_with_journal('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000c1',
      CURRENT_DATE - 3, CURRENT_DATE + 27, 'KES', 1, NULL, '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object('description', 'Cement', 'accountId', '00000000-0000-0000-0000-00000000a400', 'amountCents', 300000)), 'e2e-cn-invoice')`);
    const invoiceNumber = sql(`SELECT invoice_number FROM public.invoices WHERE id = '${invoiceId}'`);
    await openView(page, 'Sales');
    await page.getByRole('tab', { name: /Credit notes/ }).click();
    await page.getByRole('button', { name: 'New credit note' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select').first().selectOption({ label: 'Acme' });
    await dialog.locator('select').filter({ hasText: 'Keep as credit' }).selectOption({ label: `${invoiceNumber} · 3,000.00 due` });
    await dialog.getByLabel('Line 1 description').fill('Price agreed down');
    await dialog.getByLabel('Line 1 unit price, KES').fill('500');
    await dialog.getByRole('button', { name: 'Issue credit note' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByText(/CN-\d{4}-00001/).waitFor({ timeout: 10_000 });
    await page.getByText(`Applied to ${invoiceNumber}`, { exact: false }).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT amount_due_cents || ' ' || status FROM public.invoices WHERE id = '${invoiceId}'`), '250000 PARTIALLY_PAID');
    assert.deepEqual(problems, []);
  });
});

test('a supplier credit is recorded, then refunded into the bank', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('supplier-credit', session, async () => {
    await openView(page, 'Bills and expenses');
    await page.getByRole('tab', { name: 'Supplier credits' }).click();
    await page.getByRole('button', { name: 'New supplier credit' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select[name="vendorId"]').selectOption({ label: 'Kenya Power' });
    await dialog.getByLabel('Line 1 particulars').fill('Overbilled tokens');
    await dialog.getByLabel('Line 1 account').selectOption({ label: '6000 · Operating expenses' });
    await dialog.getByLabel('Line 1 amount').fill('1,000');
    await dialog.getByLabel('Line 1 VAT percentage').fill('0');
    await dialog.getByRole('button', { name: 'Record supplier credit' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByText(/SC-\d{4}-00001/).waitFor({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Refund' }).click();
    const refund = page.getByRole('dialog');
    await refund.locator('select').selectOption({ label: '1000 · Bank' });
    await refund.getByRole('button', { name: 'Post refund' }).click();
    await page.getByText(/Refund RF-\d{4}-00001 of 1,000.00 posted/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT status || ' ' || remaining_cents FROM public.credit_notes WHERE kind = 'SUPPLIER'`), 'CLOSED 0');
    assert.deepEqual(problems, []);
  });
});

test('a purchase order is written, then billed for what arrived', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('purchase-order', session, async () => {
    const before = Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE name = 'Cement 50kg'`));
    await openView(page, 'Bills and expenses');
    await page.getByRole('tab', { name: 'Purchase orders' }).click();
    await page.getByRole('button', { name: 'New purchase order' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select').first().selectOption({ label: 'Kenya Power' });
    await dialog.getByLabel('Line 1 stock item').selectOption({ label: 'Cement 50kg' });
    await dialog.getByLabel('Line 1 quantity').fill('10');
    await dialog.getByLabel('Line 1 unit cost, KES').fill('700');
    await dialog.getByLabel('Line 1 account').selectOption({ label: '6000 Operating expenses' });
    await dialog.getByRole('button', { name: 'Save purchase order' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByText(/PO-\d{4}-00001/).first().waitFor({ timeout: 10_000 });
    assert.equal(sql(`SELECT count(*) FROM public.journal_entries WHERE source_id = (SELECT id FROM public.purchase_orders LIMIT 1)`), '0');

    await page.getByRole('button', { name: 'Make a bill' }).click();
    const billing = page.getByRole('dialog');
    await billing.getByLabel('Quantity to bill, Cement 50kg').fill('4');
    await billing.getByRole('button', { name: 'Post bill' }).click();
    await page.getByText(/The rest stays on the order/).waitFor({ timeout: 10_000 });
    await page.getByText('Cement 50kg · 4 of 10 billed').waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT total_cents FROM public.bills WHERE purchase_order_id IS NOT NULL`), '280000');
    assert.equal(Number(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE name = 'Cement 50kg'`)), before + 4);
    assert.deepEqual(problems, []);
  });
});

test('an invoice is made recurring and the next one posted now', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('recurring-invoice', session, async () => {
    const invoiceId = sql(`SELECT public.create_invoice_with_journal('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-0000000000c1',
      CURRENT_DATE, CURRENT_DATE + 14, 'KES', 1, 'Retainer', '00000000-0000-0000-0000-000000000001',
      jsonb_build_array(jsonb_build_object('description', 'Monthly bookkeeping', 'accountId', '00000000-0000-0000-0000-00000000a400', 'amountCents', 1500000)), 'e2e-recurring-source')`);
    const invoiceNumber = sql(`SELECT invoice_number FROM public.invoices WHERE id = '${invoiceId}'`);
    await openView(page, 'Sales');
    await page.getByRole('tab', { name: 'Recurring' }).click();
    await page.getByRole('button', { name: 'New recurring invoice' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select').first().selectOption({ label: `${invoiceNumber} · Acme · 15,000.00` });
    await dialog.getByLabel('Name').fill('Acme retainer');
    await dialog.getByLabel('Due after, days').fill('7');
    await dialog.getByRole('button', { name: 'Save schedule' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.getByText(/Every month from/).waitFor({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Post the next one now' }).click();
    await page.getByText(/posted from Acme retainer/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT occurrences || ' ' || days_until_due FROM public.recurring_templates WHERE name = 'Acme retainer'`), '1 7');
    assert.equal(sql(`SELECT count(*) FROM public.invoices WHERE notes = 'Retainer'`), '2');
    assert.deepEqual(problems, []);
  });
});
