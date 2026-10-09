// Records, stock, settings, team, orders, banking and payroll screens
// against the real API.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { signedIn, openView, chooseOption, refusedWrites, closeBrowser, sql, flow } from './helpers.mjs';

after(closeBrowser);
const ORG = '00000000-0000-0000-0000-0000000000aa';

test('a customer is added, then edited from its record', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('customer', session, async () => {
    await openView(page, 'Customers');
    await page.getByRole('button', { name: 'Add customer' }).first().click();
    const form = page.getByRole('dialog');
    await form.locator('input[name="displayName"]').fill('Baraka Hardware');
    await form.locator('input[name="email"]').fill('accounts@baraka.example');
    await form.locator('input[name="contactPerson"]').fill('Achieng Otieno');
    await form.getByRole('button', { name: 'Save customer' }).click();
    await form.waitFor({ state: 'hidden', timeout: 10_000 });

    await page.locator('button:has-text("Baraka Hardware") >> visible=true').first().click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog').last();
    await edit.locator('input[name="displayName"]').fill('Baraka Hardware Ltd');
    await edit.locator('input[name="contactPerson"]').fill('');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await page.waitForTimeout(1500);
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT display_name || '|' || coalesce(contact_person, '(none)') || '|' || email FROM public.customers WHERE email = 'accounts@baraka.example'`), 'Baraka Hardware Ltd|(none)|accounts@baraka.example');
    assert.deepEqual(problems, []);
  });
});

test('customers are imported from a spreadsheet, a bad row fixed by skipping it', async () => {
  const session = await signedIn();
  const { page, problems } = session;
  await flow('customer-import', session, async () => {
    await openView(page, 'Customers');
    await page.getByRole('button', { name: 'Import from a spreadsheet' }).click();
    const dialog = page.getByRole('dialog');
    const csv = [
      'Customer Name,Email,Phone,KRA PIN',
      'Jamii Bakery,orders@jamii.example,0711 222 333,P051111111A',
      'Upendo Salon,not-an-email,0722 444 555,',
      'Acme,,,',
    ].join('\n');
    await dialog.locator('input[name="records"]').setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await dialog.getByText('3 rows to import').waitFor({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Import 3 rows' }).click();
    await dialog.getByText('Rows to fix').waitFor({ timeout: 10_000 });
    await dialog.getByText(/Row 3 · email/).waitFor({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Add the other 2' }).click();
    await page.getByText(/1 customer added; 1 already in the books and skipped; 1 with problems left out/).waitFor({ timeout: 10_000 });
    assert.equal(sql(`SELECT kra_pin FROM public.customers WHERE display_name = 'Jamii Bakery'`), 'P051111111A');
    assert.equal(sql(`SELECT count(*) FROM public.customers WHERE display_name = 'Upendo Salon'`), '0');
    assert.deepEqual(problems.filter((p) => !/422/.test(p)), []);
  });
});

test('a stock count is recorded with its reason', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('count', session, async () => {
    await openView(page, 'Inventory');
    await page.getByRole('button', { name: 'Count Cement 50kg' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Quantity counted/).fill('3');
    await dialog.getByLabel('Reason').fill('Two bags torn');
    await dialog.getByRole('button', { name: 'Record count' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE name = 'Cement 50kg'`), '3');
    assert.deepEqual(problems, []);
  });
});

test('closing date, approval limit and time zone are saved from Settings', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('controls', session, async () => {
    await openView(page, 'Company');
    await page.getByRole('tab', { name: 'Closing and controls' }).click();
    await page.getByLabel('Books closed through').fill('2026-06-30');
    await page.getByLabel(/Approval limit/).fill('250,000');
    await page.getByRole('button', { name: 'Save controls' }).click();
    await page.getByText('Controls saved.').waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT books_closed_through || '|' || approval_threshold_cents || '|' || time_zone FROM public.organizations WHERE id = '${ORG}'`), '2026-06-30|25000000|Africa/Nairobi');
    assert.deepEqual(problems, []);
  });
});

test('a class is added, an expense posted under it, and the profit and loss split by class', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('classes', session, async () => {
    await openView(page, 'Company');
    await page.getByRole('tab', { name: 'Classes and locations' }).click();
    await page.locator('input[name="new-class"]').fill('Contracts');
    await page.getByRole('button', { name: 'Add class' }).click();
    await page.getByText('Contracts', { exact: true }).waitFor({ timeout: 10_000 });

    await openView(page, 'Expenses & suppliers');
    await page.getByRole('tab', { name: 'Expenses' }).click();
    await page.getByRole('button', { name: 'New expense' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[name="payeeName"]').fill('Site transporter');
    await chooseOption(dialog, 'Paid from', '1000 · Bank');
    await dialog.locator('select[name="classId"]').selectOption({ label: 'Contracts' });
    await dialog.getByLabel('Line 1 particulars').fill('Haulage to site');
    await chooseOption(dialog, 'Line 1 account', '6000 · Operating expenses');
    await dialog.getByLabel('Line 1 amount').fill('4,000');
    await dialog.getByLabel('Line 1 VAT percentage').fill('0');
    await dialog.getByRole('button', { name: 'Post expense' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    assert.equal(sql(`SELECT t.name FROM public.journal_entries e JOIN public.tracking_categories t ON t.id = e.class_id JOIN public.cash_transactions c ON c.journal_entry_id = e.id WHERE c.payee_name = 'Site transporter'`), 'Contracts');

    await openView(page, 'Reports');
    await page.getByRole('button', { name: /^Profit and loss by class/ }).click();
    await page.getByRole('columnheader', { name: 'Contracts' }).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.deepEqual(problems, []);
  });
});

test('an invitation is sent and withdrawn from Team', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('team', session, async () => {
    await openView(page, 'Team');
    await page.getByRole('button', { name: 'Invite a member' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Email address').fill('stores@baraka.example');
    await dialog.locator('select').selectOption('accountant');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await page.getByText('Waiting to accept').waitFor({ timeout: 10_000 });
    assert.equal(sql(`SELECT role || '|' || status FROM public.organization_invitations WHERE email = 'stores@baraka.example'`), 'accountant|PENDING');
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await page.getByText('Invitation withdrawn.').waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.notEqual(sql(`SELECT status FROM public.organization_invitations WHERE email = 'stores@baraka.example'`), 'PENDING');
    assert.deepEqual(problems, []);
  });
});

test('an order is recorded, completed and invoiced', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('order', session, async () => {
    await openView(page, 'Sales & customers');
    await page.getByRole('tab', { name: /Orders/ }).click();
    await page.getByRole('button', { name: 'New order' }).click();
    const dialog = page.getByRole('dialog');
    await chooseOption(dialog, 'Customer', 'Acme');
    await chooseOption(dialog, 'Line 1 stock item', 'Cement 50kg');
    await dialog.getByLabel('Line 1 quantity').fill('2');
    await dialog.getByRole('button', { name: 'Record order' }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    await page.locator('button:has-text("Mark completed") >> visible=true').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Mark completed' }).click();
    await page.waitForTimeout(1200);
    assert.equal(sql(`SELECT quantity_on_hand FROM public.inventory_items WHERE name = 'Cement 50kg'`), '1');
    // A completed order leaves the open view.
    await page.getByLabel('Show').selectOption('COMPLETED');
    await page.getByRole('button', { name: 'Invoice', exact: true }).locator('visible=true').first().click();
    await page.getByRole('dialog').getByRole('button', { name: 'Raise invoice' }).click();
    await page.waitForTimeout(1500);
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT count(*) FROM public.sales_orders WHERE status = 'COMPLETED' AND invoice_id IS NOT NULL`), '1');
    assert.deepEqual(problems, []);
  });
});

test('a statement line is posted to an account, then the match undone', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('banking', session, async () => {
    await openView(page, 'Banking');
    const row = page.locator('tr', { hasText: 'KPLC TOKENS' });
    await row.getByRole('button', { name: /Match/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('section[aria-labelledby="match-new"] select').selectOption({ label: '6000 Operating expenses' });
    await dialog.getByRole('button', { name: 'Post', exact: true }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    assert.equal(sql(`SELECT status FROM public.bank_transactions WHERE description = 'KPLC TOKENS'`), 'MATCHED');
    await page.locator('tr', { hasText: 'KPLC TOKENS' }).getByRole('button', { name: 'Undo match' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Undo match' }).click();
    await page.getByText('Match undone.').waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.notEqual(sql(`SELECT status FROM public.bank_transactions WHERE description = 'KPLC TOKENS'`), 'MATCHED');
    assert.deepEqual(problems, []);
  });
});

test('an M-Pesa statement is imported, then the till reconciled to it', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('statement-import', session, async () => {
    await openView(page, 'Banking');
    await page.getByRole('button', { name: 'Import statement' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('select[name="accountId"]').selectOption({ label: '1050 · M-Pesa Till' });
    const csv = [
      'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance',
      'SB71,2026-09-02 10:00:00,Customer Payment from ACME,Completed,"1,200.00",,1200.00',
      'SB72,2026-09-03 11:30:00,Pay Bill to KPLC,Completed,,-300.00,900.00',
    ].join('\n');
    await dialog.locator('input[name="statement"]').setInputFiles({ name: 'mpesa-sep.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await dialog.getByText('2 lines read').waitFor({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Import 2 lines' }).click();
    await page.getByText(/2 lines imported to M-Pesa Till/).waitFor({ timeout: 10_000 });
    assert.equal(sql(`SELECT count(*) FROM public.bank_transactions WHERE reference IN ('SB71', 'SB72')`), '2');

    // Reconcile the till to what the ledger holds today, every line ticked.
    const balance = Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${ORG}' AND a.code = '1050'`));
    await page.getByRole('tab', { name: 'Reconcile' }).click();
    await page.locator('select[name="reconcileAccount"]').selectOption({ label: '1050 · M-Pesa Till' });
    await page.locator('input[name="statementBalance"]').fill((balance / 100).toFixed(2));
    await page.getByRole('button', { name: 'Start reconciling' }).click();
    await page.getByRole('button', { name: 'Tick every line' }).click();
    await page.getByRole('button', { name: 'Finish reconciliation' }).click();
    await page.getByText(/M-Pesa Till reconciled to/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT status FROM public.bank_reconciliations ORDER BY created_at DESC LIMIT 1`), 'COMPLETED');
    assert.deepEqual(problems, []);
  });
});

test('an employee is added, a month is paid and the run reversed', async () => {
  const session = await signedIn();
  const { page, api, problems } = session;
  await flow('payroll', session, async () => {
    await openView(page, 'Payroll');
    await page.getByRole('button', { name: 'Add employee' }).click();
    const form = page.getByRole('dialog');
    await form.locator('input[name="firstName"]').fill('Wanjiru');
    await form.locator('input[name="lastName"]').fill('Kamau');
    await form.getByRole('tab', { name: 'Pay' }).click();
    await form.locator('input[name="baseSalary"]').fill('65000');
    await form.getByRole('button', { name: 'Save employee' }).click();
    await form.waitFor({ state: 'hidden', timeout: 10_000 });

    await page.getByRole('tab', { name: 'Pay run' }).click();
    await page.getByLabel('Period').fill('September 2026');
    await page.getByLabel('Pay date').fill('2026-09-30');
    await page.getByRole('button', { name: 'Post this pay run' }).click();
    await page.getByText(/Pay run for September 2026 posted/).waitFor({ timeout: 10_000 });

    await page.getByRole('tab', { name: 'Payslips' }).click();
    await page.getByRole('button', { name: 'Reverse this pay run' }).click();
    await page.getByLabel('Reason').fill('Wrong housing allowance');
    await page.getByRole('button', { name: 'Reverse pay run' }).click();
    await page.getByText(/Reversed on/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    assert.equal(sql(`SELECT count(*) FROM public.payroll_runs WHERE reversed_at IS NOT NULL`), '1');
    assert.deepEqual(problems, []);
  });
});

test('a read-only member sees the books and is told AI is off', async () => {
  const session = await signedIn('member@example.com');
  const { page, api, problems } = session;
  await flow('member', session, async () => {
    await openView(page, 'Business feed');
    await page.getByLabel('Your question').fill('What do we owe suppliers?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await page.getByText(/AI features are off for this organization/).first().waitFor({ timeout: 10_000 });
    const ask = api.find((call) => call.path === '/api/ai/ask');
    assert.equal(ask?.status, 403, 'refused for AI being off, not for the member role');
    assert.deepEqual(problems, []);
  });
});
