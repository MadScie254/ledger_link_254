// The posting screens against the real API. Each flow drives the screen as
// a person would and then checks the database, and that no request the
// screen made was refused.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { signedIn, openView, refusedWrites, closeBrowser, sql, flow } from './helpers.mjs';

after(closeBrowser);
const ORG = '00000000-0000-0000-0000-0000000000aa';

test('an invoice is written, posted, paid and the payment reversed', async () => {
  const { page, api, problems } = await signedIn();
  await openView(page, 'Sales');
  await page.getByRole('button', { name: 'New invoice' }).first().click();
  await page.locator('select[required]').first().selectOption({ label: 'Acme' });
  await page.getByLabel('Line 1 particulars').fill('Cement, 10 bags');
  await page.getByLabel('Line 1 income account').selectOption({ label: '4000 · Sales' });
  await page.getByLabel('Line 1 VAT percentage').fill('16');
  await page.getByLabel(/Line 1 amount/).fill('8500');
  await page.getByRole('button', { name: 'Post invoice' }).click();
  await page.getByRole('button', { name: 'New invoice' }).first().waitFor({ timeout: 10_000 });
  assert.deepEqual(refusedWrites(api), []);
  assert.equal(sql(`SELECT total_cents FROM public.invoices WHERE org_id = '${ORG}' ORDER BY created_at DESC LIMIT 1`), '986000');

  await page.locator('button:has-text("Receive payment") >> visible=true').first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Amount received/).fill('5000');
  await dialog.getByLabel('Deposit account').selectOption({ label: '1000 · Bank' });
  await dialog.getByRole('button', { name: 'Post payment' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  assert.deepEqual(refusedWrites(api), []);
  assert.equal(sql(`SELECT amount_due_cents FROM public.invoices WHERE org_id = '${ORG}' ORDER BY created_at DESC LIMIT 1`), '486000');

  // Reverse it from the invoice's record.
  await page.locator('button:has-text("Acme") >> visible=true').first().click();
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  await page.getByLabel('Reason').fill('Cheque returned unpaid');
  await page.getByRole('button', { name: 'Reverse payment' }).click();
  await page.getByText(/reversed on/).waitFor({ timeout: 10_000 });
  assert.deepEqual(refusedWrites(api), []);
  assert.equal(sql(`SELECT amount_due_cents FROM public.invoices WHERE org_id = '${ORG}' ORDER BY created_at DESC LIMIT 1`), '986000');
  assert.deepEqual(problems, []);
});

test('a bill with a supplier reference is entered and paid', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('bill', session, async () => {
  await openView(page, 'Bills and expenses');
  await page.getByRole('button', { name: 'New bill' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('select[name="vendorId"]').selectOption({ label: 'Kenya Power' });
  await dialog.locator('input[name="supplierReference"]').fill('KPLC-2026-0917');
  await dialog.getByLabel('Line 1 particulars').fill('Electricity, September');
  await dialog.getByLabel('Line 1 account').selectOption({ label: '6000 · Operating expenses' });
  await dialog.getByLabel('Line 1 amount').fill('12,000');
  await dialog.getByLabel('Line 1 VAT percentage').fill('16');
  await dialog.getByRole('button', { name: 'Add a line' }).click();
  await dialog.getByLabel('Line 2 stock item').selectOption({ label: 'Cement 50kg' });
  await dialog.getByLabel('Line 2 account').selectOption({ label: '5000 · Cost of Goods Sold' });
  await dialog.getByLabel('Line 2 quantity').fill('10');
  await dialog.getByLabel('Line 2 amount').fill('7000');
  await dialog.getByLabel('Line 2 VAT percentage').fill('0');
  await dialog.getByRole('button', { name: 'Save bill' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  assert.deepEqual(refusedWrites(api), []);
  assert.equal(sql(`SELECT total_cents || ' ' || supplier_reference FROM public.bills WHERE org_id = '${ORG}'`), '2092000 KPLC-2026-0917');
  assert.equal(sql(`SELECT quantity_on_hand || ' ' || cost_price_cents FROM public.inventory_items WHERE name = 'Cement 50kg'`), '15 70000');

  await page.getByRole('tab', { name: /Bill payments/ }).click();
  await page.getByLabel('Pay from').selectOption({ label: '1000 · Bank' });
  await page.getByRole('button', { name: 'Post these payments' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Post' }).click();
  await page.getByText('No open bills.').waitFor({ timeout: 10_000 });
  assert.deepEqual(refusedWrites(api), []);
  assert.equal(sql(`SELECT status FROM public.bills WHERE org_id = '${ORG}'`), 'PAID');
  assert.deepEqual(problems, []);
  });
});

test('a journal entry is posted by hand', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('journal', session, async () => {
  await openView(page, 'Accounting');
  await page.getByRole('tab', { name: /Journal entries/ }).click();
  await page.getByRole('button', { name: 'Post an entry' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Particulars').fill('Owner capital paid in');
  await dialog.getByLabel('Line 1 account').selectOption({ label: '1000 · Bank' });
  await dialog.getByLabel('Line 1 debit').fill('50000');
  await dialog.getByLabel('Line 2 account').selectOption({ label: '3000 · Owner capital' });
  await dialog.getByLabel('Line 2 credit').fill('50000');
  await dialog.getByRole('button', { name: 'Post entry' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  assert.deepEqual(refusedWrites(api), []);
  assert.equal(sql(`SELECT count(*) FROM public.journal_entries WHERE org_id = '${ORG}' AND memo = 'Owner capital paid in'`), '1');
  assert.deepEqual(problems, []);
  });
});

test('an estimate is written, sent, accepted and invoiced', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('estimate', session, async () => {
    await openView(page, 'Sales');
    await page.getByRole('tab', { name: /Estimates/ }).click();
    await page.getByRole('button', { name: 'New estimate' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select').first().selectOption({ label: 'Acme' });
    await dialog.getByLabel('Line 1 stock item').selectOption({ label: 'Cement 50kg' });
    await dialog.getByLabel('Line 1 quantity').fill('20');
    await dialog.getByLabel('Line 1 VAT rate').fill('16');
    await dialog.getByRole('button', { name: 'Save estimate' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    assert.equal(sql(`SELECT status || ' ' || total_cents FROM public.estimates`), 'DRAFT 1740000');

    await page.getByRole('button', { name: 'Mark sent' }).click();
    await page.getByText(/marked sent/).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Accepted', exact: true }).click();
    await page.getByText(/marked accepted/).waitFor({ timeout: 10_000 });
    await page.getByLabel('Show').selectOption('ACCEPTED');
    await page.getByRole('button', { name: 'Invoice', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Raise invoice' }).click();
    await page.getByText(/raised from estimate/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT e.status || ' ' || i.total_cents FROM public.estimates e JOIN public.invoices i ON i.id = e.invoice_id`), 'CONVERTED 1740000');
    assert.deepEqual(problems, []);
  });
});
