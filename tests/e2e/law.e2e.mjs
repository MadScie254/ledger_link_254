// The Mizani pilot sequence in the browser, as an advocate works it: open a
// matter after a conflict check, add a court date, record time and a
// disbursement, hold and spend client money, raise a fee note, settle part
// from client money and the rest net of withholding, then check that every
// control account reconciles.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { signedIn, openView, refusedWrites, closeBrowser, sql, flow } from './helpers.mjs';

after(closeBrowser);
const lawOrg = () => sql(`SELECT id FROM public.organizations WHERE name = 'Wanjiru & Otieno Advocates (test)'`);
const balance = (code) => Number(sql(`SELECT COALESCE(sum(l.debit - l.credit), 0) FROM public.journal_lines l JOIN public.accounts a ON a.id = l.account_id WHERE a.org_id = '${lawOrg()}' AND a.code = '${code}'`));

test('a matter is opened, worked, billed and settled, and the client account reconciles', async () => {
  const session = await signedIn('advocate@example.com');
  const { page, api, problems } = session;
  await flow('law-pilot', session, async () => {
    // A law firm opens on its practice Home.
    await page.getByText('Open matters').waitFor({ timeout: 15_000 });
    await openView(page, 'Matters');
    await page.getByRole('button', { name: 'Open a matter' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.locator('select[name="clientId"]').selectOption('NEW');
    await dialog.locator('input[name="newClient"]').fill('Achieng Otieno');
    await dialog.locator('input[name="title"]').fill('Otieno v Kamau, land dispute');
    await dialog.locator('input[name="defaultRateCents"]').fill('15,000');
    await dialog.locator('input[name="court"]').fill('ELC Nairobi');
    // The conflict search runs before the matter can be opened.
    await dialog.getByRole('button', { name: 'Check for conflicts' }).click();
    await dialog.getByText(/No client or party named like/).waitFor({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Open matter' }).click();
    await page.getByText(/Matter MAT-\d{4}-\d{4} opened\./).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    const matterNumber = sql(`SELECT matter_number FROM public.matters WHERE org_id = '${lawOrg()}'`);
    assert.match(matterNumber, /^MAT-\d{4}-\d{4}$/);

    // A party, then a court date.
    await page.getByRole('tab', { name: /^Parties/ }).click();
    await page.getByRole('button', { name: 'Add a party' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="partyName"]').fill('Peter Kamau');
    await dialog.getByRole('button', { name: 'Add party' }).click();
    await page.getByText('Peter Kamau added').waitFor({ timeout: 10_000 });
    await page.getByRole('tab', { name: /^Diary/ }).click();
    await page.getByRole('button', { name: 'Add a court date' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="startsAt"]').fill('2026-11-03T09:00');
    await dialog.getByRole('button', { name: 'Add to the diary' }).click();
    await page.getByText(/Hearing set for 03\/11\/2026 at 09:00/).waitFor({ timeout: 10_000 });

    // Two and a half hours at KES 15,000 an hour, and a search fee the firm paid.
    await page.getByRole('tab', { name: /^Time/ }).click();
    await page.getByRole('button', { name: 'Record time' }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="hours"]').fill('2.5');
    await dialog.locator('input[name="description"]').fill('Drafting the plaint');
    await dialog.getByRole('button', { name: 'Record time' }).click();
    await page.getByText(/2.5 hours recorded/).waitFor({ timeout: 10_000 });
    await page.getByRole('tab', { name: /^Disbursements/ }).click();
    await page.getByRole('button', { name: 'Record an office disbursement' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="description"]').fill('Search fees, Ardhisasa');
    await dialog.locator('input[name="amount"]').fill('2,000');
    await dialog.getByRole('button', { name: 'Record disbursement' }).click();
    await page.getByText(/disbursement recorded/).waitFor({ timeout: 10_000 });

    // KES 50,000 into client account, a KES 2,500 court fee out of it.
    await page.getByRole('tab', { name: /^Client money/ }).click();
    await page.getByRole('button', { name: 'Receive client money' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="amount"]').fill('50,000');
    await dialog.locator('input[name="reference"]').fill('EFT-889');
    await dialog.getByRole('button', { name: 'Record receipt' }).click();
    await page.getByText(/received into the client account/).waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Pay out' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="amount"]').fill('2,500');
    await dialog.locator('input[name="payee"]').fill('Judiciary');
    await dialog.locator('input[name="purpose"]').fill('Court filing fee');
    await dialog.locator('input[name="asDisbursement"]').check();
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await page.getByText(/paid to Judiciary/).waitFor({ timeout: 10_000 });

    // A fee note from the unbilled time and the office disbursement.
    await page.getByRole('tab', { name: /^Fee notes/ }).click();
    await page.getByRole('button', { name: 'Raise a fee note' }).first().click();
    dialog = page.getByRole('dialog');
    await dialog.getByText('Drafting the plaint').waitFor({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Raise fee note' }).click();
    await page.getByText(/Fee note raised on MAT-/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);
    const feeNote = sql(`SELECT invoice_number || ' ' || total_cents FROM public.invoices WHERE org_id = '${lawOrg()}'`);
    assert.match(feeNote, / 3950000$/, 'KES 37,500 of fees and KES 2,000 of disbursements');

    // KES 20,000 from client money, the rest from the client less 5% withholding on fees.
    await page.getByRole('tab', { name: /^Client money/ }).click();
    await page.getByRole('button', { name: 'Transfer to office' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('select[name="invoiceId"]').selectOption({ index: 1 });
    await dialog.locator('input[name="amount"]').fill('20,000');
    await dialog.getByRole('button', { name: 'Transfer' }).click();
    await page.getByText(/transferred from client money/).waitFor({ timeout: 10_000 });
    await page.getByRole('tab', { name: /^Fee notes/ }).click();
    await page.getByRole('button', { name: 'Receive payment' }).click();
    dialog = page.getByRole('dialog');
    await dialog.locator('input[name="cash"]').fill('17,625');
    await dialog.locator('input[name="wht"]').fill('1,875');
    await dialog.locator('input[name="whtCertificateNumber"]').fill('WHT-2026-77');
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await page.getByText(/with 1,875.00 withheld/).waitFor({ timeout: 10_000 });
    assert.deepEqual(refusedWrites(api), []);

    // Every control account agrees.
    assert.equal(balance('1060'), 2_750_000, 'client bank: 50,000 less 2,500 and 20,000');
    assert.equal(-balance('2200'), 2_750_000, 'client money held');
    assert.equal(balance('1100'), 0, 'the fee note is settled');
    assert.equal(balance('1170'), 187_500, 'withholding tax receivable');
    assert.equal(balance('1180'), 0, 'the disbursement is recovered');
    assert.equal(Number(sql(`SELECT sum(debit) - sum(credit) FROM public.journal_lines WHERE org_id = '${lawOrg()}'`)), 0, 'the trial balance balances');

    // The fee note saves as a PDF.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button[aria-label$="as a PDF"] >> visible=true').first().click(),
    ]);
    assert.match(download.suggestedFilename(), /^Fee-note-INV-/);

    // The client account screen and the diary read the same books.
    await openView(page, 'Client account');
    await page.getByText(/holds exactly what the matter ledgers say is owed to clients/).waitFor({ timeout: 10_000 });
    await openView(page, 'Court diary');
    await page.getByLabel('Diary date').fill('2026-11-03');
    await page.getByText('Hearing').first().waitFor({ timeout: 10_000 });
    assert.deepEqual(problems, []);
  });
});
