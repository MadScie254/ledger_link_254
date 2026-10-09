// The New menu puts each edition's own actions first and opens the form on
// the page that owns it.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { signedIn, closeBrowser } from './helpers.mjs';

after(closeBrowser);

for (const [edition, email, expected, pick, form] of [
  ['Mizani', 'advocate@example.com', ['Matter', 'Court date', 'Time entry', 'Client receipt', 'Office disbursement'], 'Matter', 'Open a matter'],
  ['Kundi', 'treasurer@example.com', ['Gift', 'Cash count', 'M-Pesa statement', 'Member'], 'Gift', 'Record a gift'],
]) {
  test(`New opens ${edition}'s own forms`, async () => {
    const { page, problems } = await signedIn(email);
    await page.getByRole('button', { name: 'New', exact: true }).first().click();
    const menu = page.getByRole('dialog', { name: 'New' });
    const offered = await menu.getByRole('button').allTextContents();
    for (const label of expected) assert.ok(offered.includes(label), `${label} is missing from New: ${offered.join(', ')}`);
    await menu.getByRole('button', { name: pick, exact: true }).click();
    await page.getByRole('dialog', { name: form }).waitFor({ timeout: 10_000 });
    assert.deepEqual(problems, []);
  });
}
