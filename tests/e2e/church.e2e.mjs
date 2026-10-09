// The Kundi pilot sequence in the browser, as a treasurer works it: import
// the register from CSV, count a Sunday's cash with a second person and
// bank it KES 100 short, take an M-Pesa confirmation for member 1043,
// place one the rules could not, print the treasurer's report, and check
// that fund balances reconcile to the trial balance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { BASE, signedIn, openView, refusedWrites, closeBrowser, sql, flow } from './helpers.mjs';

after(closeBrowser);
const TOKEN = 'e2e0'.repeat(16);
const confirmation = JSON.parse(readFileSync(new URL('../integration/fixtures/c2b-confirmation-1043.json', import.meta.url), 'utf8'));
const church = () => sql(`SELECT id FROM public.organizations WHERE name = 'Kanisa la Majaribio (test)'`);
const fund = (code) => sql(`SELECT id FROM public.funds WHERE org_id = '${church()}' AND code = '${code}'`);
const balance = (code) => Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${church()}' AND a.code = '${code}'`));

// Fifty made-up members, 1001 to 1050; every other one with a phone and consent.
const memberCsv = [
  'Member No,First name,Surname,Phone,Consent,Status,Household',
  ...Array.from({ length: 50 }, (_, i) => [
    1001 + i, `Mshiriki${i + 1}`, 'Mfano', i % 2 ? '' : `07000${String(i).padStart(5, '0')}`, i % 2 ? '' : 'Signed form',
    i % 10 === 0 ? 'Visitor' : 'Member', `Nyumba ${Math.floor(i / 5) + 1}`,
  ].join(',')),
].join('\n');

async function fillCounts(dialog, counts) {
  for (const [value, count] of Object.entries(counts)) await dialog.locator(`input[name="count-${value}"]`).fill(String(count));
}

async function replay(body) {
  const response = await fetch(`${BASE}/api/public/giving/c2b/${TOKEN}/confirmation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function waitFor(check, what) {
  for (let i = 0; i < 40; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

test('a church imports its register, counts and banks a collection, takes M-Pesa giving and reconciles', async () => {
  const session = await signedIn('treasurer@example.com');
  const { page, api, problems } = session;
  await flow('church-pilot', session, async () => {
    // A church opens on its giving Home.
    await page.getByText('This month so far').waitFor({ timeout: 15_000 });

    // Fifty members from a CSV.
    await openView(page, 'Members');
    await page.getByRole('button', { name: 'Import from CSV' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.locator('input[name="file"]').setInputFiles({ name: 'register.csv', mimeType: 'text/csv', buffer: Buffer.from(memberCsv) });
    await dialog.getByText('50 members ready to import.').waitFor({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Import members (50)' }).click();
    await page.getByText('50 members imported, with 10 new households.').waitFor({ timeout: 15_000 });
    assert.equal(sql(`SELECT count(*) FROM public.members WHERE org_id = '${church()}'`), '50');
    assert.equal(sql(`SELECT count(*) FROM public.members WHERE org_id = '${church()}' AND phone IS NOT NULL AND consent_method = 'Signed form'`), '25');

    // The first counter saves Sunday's count.
    await openView(page, 'Cash count');
    await page.getByRole('button', { name: 'Start a cash count' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="serviceDate"]').fill('2026-10-04');
    await fillCounts(dialog, { 1000: 12, 500: 3, 100: 1 });
    await dialog.getByRole('button', { name: 'Save the first count' }).click();
    await page.getByText(/Cash count COL-2026-\d{4} saved\. It waits for a second person to count it\./).waitFor({ timeout: 10_000 });
    await page.getByText('You made the first count. Another person confirms it.').waitFor();
    assert.equal(balance('1040'), 0, 'nothing posts on the first count');
    assert.deepEqual(refusedWrites(api), []);

    // The second counter, from their own sign-in: a wrong count is refused with both totals, then the right one posts.
    const counter = await signedIn('counter@example.com');
    await openView(counter.page, 'Cash count');
    await counter.page.getByRole('button', { name: 'Count it again' }).click();
    let second = counter.page.getByRole('dialog');
    await fillCounts(second, { 1000: 12, 500: 3, 100: 2 });
    await second.getByRole('button', { name: 'Confirm and post' }).click();
    await second.getByRole('alert').filter({ hasText: /13,700\.00/ }).filter({ hasText: /13,600\.00/ }).waitFor({ timeout: 10_000 });
    assert.equal(balance('1040'), 0, 'counts that differ post nothing');
    const refusedSoFar = counter.api.length;
    await second.locator('input[name="count-100"]').fill('1');
    await second.getByRole('button', { name: 'Confirm and post' }).click();
    await counter.page.getByText(/Cash count COL-2026-\d{4} confirmed and posted to cash on hand \(1040\)\./).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(counter.api, refusedSoFar), []);
    assert.equal(balance('1040'), 1_360_000);
    await counter.context.close();

    // Banked KES 100 short: the shortfall goes to bank charges.
    await openView(page, 'Home');
    await openView(page, 'Cash count');
    await page.getByRole('button', { name: 'Bank it' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="amount"]').fill('13500');
    await dialog.getByText('The bank received KES 100.00 less than was counted. The shortfall posts to bank charges (6400).').waitFor();
    await dialog.getByRole('button', { name: 'Post the banking' }).click();
    await page.getByText(/COL-2026-\d{4} banked\. The bank received KES 100\.00 less than was counted\./).waitFor({ timeout: 10_000 });
    assert.equal(balance('1040'), 0);
    assert.equal(balance('1000'), 1_350_000);
    assert.equal(balance('6400'), 10_000);

    // Safaricom's confirmation for reference 1043 lands on member 1043 in GENERAL.
    const first = await replay(confirmation);
    assert.deepEqual(first, { status: 200, body: { ResultCode: '0', ResultDesc: 'Accepted' } });
    await waitFor(() => sql(`SELECT count(*) FROM public.contributions WHERE org_id = '${church()}' AND mpesa_receipt_id IS NOT NULL`) === '1', 'the M-Pesa gift to post');
    assert.equal(sql(`SELECT m.member_number || ':' || f.code || ':' || c.amount_cents FROM public.contributions c
      JOIN public.members m ON m.id = c.member_id JOIN public.funds f ON f.id = c.fund_id
      WHERE c.org_id = '${church()}' AND c.mpesa_receipt_id IS NOT NULL`), '1043:GENERAL:250000');
    assert.equal((await replay(confirmation)).status, 200, 'a repeat is acknowledged');
    assert.equal(sql(`SELECT count(*) FROM public.mpesa_receipts WHERE org_id = '${church()}'`), '1', 'and kept once');
    assert.equal((await fetch(`${BASE}/api/public/giving/c2b/${'0'.repeat(64)}/confirmation`, { method: 'POST', body: '{}' })).status, 404);

    // One the rules cannot place waits in the queue; the treasurer places it.
    await replay({ ...confirmation, TransID: 'TJE2E00002', BillRefNumber: 'harambee', TransAmount: '1000.00' });
    await waitFor(() => sql(`SELECT status FROM public.mpesa_receipts WHERE org_id = '${church()}' AND trans_id = 'TJE2E00002'`) === 'UNMATCHED', 'the receipt to be kept');
    await openView(page, 'Giving');
    await page.getByRole('tab', { name: 'Queue' }).click();
    const row = page.getByRole('row').filter({ hasText: 'TJE2E00002' });
    await row.getByText('No giving rule fits reference HARAMBEE.').waitFor({ timeout: 10_000 });
    await row.getByRole('button', { name: 'Place' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('select[name="memberId"]').selectOption(sql(`SELECT id FROM public.members WHERE org_id = '${church()}' AND member_number = '1044'`));
    await dialog.locator('select[name="fundId"]').selectOption(fund('BUILDING'));
    await dialog.getByRole('button', { name: 'Post to this fund' }).click();
    await page.getByText('M-Pesa receipt TJE2E00002 posted as giving.').waitFor({ timeout: 10_000 });
    await page.getByText('The queue is empty. Every M-Pesa receipt has been placed.').waitFor();

    // The treasurer's report for October, printed to PDF.
    await openView(page, "Treasurer's report");
    await page.locator('input[name="month"]').fill('2026-10');
    await page.getByRole('heading', { name: 'Income by fund and account' }).waitFor({ timeout: 10_000 });
    await page.getByText('Every M-Pesa receipt has been placed.').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export PDF' }).click()]);
    assert.equal(download.suggestedFilename(), 'treasurers-report-2026-10.pdf');

    // Fund balances reconcile to the trial balance.
    await openView(page, 'Fund balances');
    await page.locator('input[name="from"]').fill('2026-10-01');
    await page.locator('input[name="to"]').fill('2026-10-31');
    await page.getByText(/The funds come to the ledger/).waitFor({ timeout: 10_000 });
    assert.equal(Number(sql(`SELECT COALESCE(sum(debit - credit), 0) FROM public.journal_lines WHERE org_id = '${church()}'`)), 0);
    assert.equal(sql(`SELECT count(*) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id
      WHERE l.org_id = '${church()}' AND a.type IN ('INCOME','EXPENSE','COGS') AND l.entity_type IS DISTINCT FROM 'FUND'`), '0', 'every income and expense line has a fund');

    // Daraja keys are saved to Vault from Settings, Integrations, and never shown again.
    await openView(page, 'Settings');
    await page.getByRole('tab', { name: 'Integrations' }).click();
    await page.locator('input[type="password"]').first().fill('e2e-consumer-key');
    await page.locator('input[type="password"]').nth(1).fill('e2e-consumer-secret');
    await page.getByRole('button', { name: 'Save M-Pesa settings' }).click();
    await page.getByText('M-Pesa settings saved. The consumer key and secret are in Vault.').waitFor({ timeout: 10_000 });
    assert.ok(!api.some((call) => call.body.includes('e2e-consumer-secret')));

    assert.deepEqual(refusedWrites(api), []);
    assert.deepEqual(problems, []);
  });
});
