import assert from 'node:assert/strict';
import test from 'node:test';
import { feeNoteInput, reminderInput, reminderPrompt, treasurerInput, treasurerPrompt } from './aiDrafts.ts';

test('a reminder is drafted from the invoice facts, with the payment details as written', () => {
  const text = reminderInput({
    businessName: 'Mfano Traders Ltd', customerName: 'Acme Ltd', invoiceNumber: 'INV-2026-00014', issueDate: '2026-09-01', dueDate: '2026-09-30',
    daysOverdue: 10, totalCents: 2_958_000, amountDueCents: 1_000_000, currency: 'KES', paymentDetails: 'M-Pesa Paybill 247247, account 0712',
  });
  assert.match(text, /Invoice: INV-2026-00014, issued 2026-09-01, due 2026-09-30/);
  assert.match(text, /Overdue by: 10 days/);
  assert.match(text, /Still owed: KES 10,000.00/);
  assert.match(text, /How to pay: M-Pesa Paybill 247247, account 0712/);
  const notDue = reminderInput({ businessName: 'B', customerName: 'C', invoiceNumber: 'I', issueDate: 'x', dueDate: 'y', daysOverdue: -3, totalCents: 1, amountDueCents: 1, currency: 'USD', paymentDetails: null });
  assert.match(notDue, /Not yet overdue/);
  assert.match(notDue, /How to pay: not given/);
});

test('the reminder prompt asks for the chosen language and forbids invented terms', () => {
  assert.match(reminderPrompt('sw'), /Kiswahili/);
  assert.match(reminderPrompt('en'), /in English/);
  assert.match(reminderPrompt('en'), /Do not invent bank details/);
  assert.match(treasurerPrompt('sw'), /Kiswahili/);
  assert.match(treasurerPrompt('sw'), /mfuko/);
  assert.doesNotMatch(treasurerPrompt('en'), /mfuko/);
  assert.match(treasurerPrompt('en'), /do not work out differences yourself/);
});

test('a fee note narrative is drafted from the work, without contact details', () => {
  const text = feeNoteInput(
    { title: 'Otieno v. Kamau, call 0722000111', matterNumber: 'WO/2026/004' },
    [{ date: '2026-09-02', hours: 1.5, description: 'Perusal of plaint and   annexures' }, { date: '2026-09-04', hours: 2, description: null }],
    [{ date: '2026-09-03', description: 'Court filing fees' }],
  );
  assert.match(text, /Matter: WO\/2026\/004 Otieno v\. Kamau, call \[phone\]/);
  assert.match(text, /- 2026-09-02: Perusal of plaint and annexures/);
  assert.match(text, /- 2026-09-04: Professional time/);
  assert.match(text, /Disbursements:\n- 2026-09-03: Court filing fees/);
  assert.doesNotMatch(text, /1\.5|hours/);
});

test('the treasurer\'s remarks are drafted from the month, the funds with money and the month before', () => {
  const text = treasurerInput({
    churchName: 'Kanisa la Mfano', monthLabel: 'September 2026', currency: 'KES',
    openingCents: 10_000_000, incomeCents: 2_500_000, expenseCents: 1_200_000, closingCents: 11_300_000,
    incomeByFund: [{ name: 'General', totalCents: 2_000_000 }, { name: 'Building', totalCents: 500_000 }, { name: 'Missions', totalCents: 0 }],
    expensesByFund: [],
    previous: { monthLabel: 'August 2026', incomeCents: 2_100_000, expenseCents: 1_500_000 },
    unmatchedCount: 4, unmatchedCents: 60_000, cashNotBankedCents: 0,
  });
  assert.match(text, /Income: KES 25,000.00/);
  assert.match(text, /- Building: KES 5,000.00/);
  assert.doesNotMatch(text, /Missions/);
  assert.match(text, /Expenses by fund:\n- none/);
  assert.match(text, /Previous month \(August 2026\): income KES 21,000.00, expenses KES 15,000.00/);
  assert.match(text, /Change from August 2026: income up KES 4,000.00, expenses down KES 3,000.00/);
  assert.match(text, /M-Pesa receipts waiting to be matched: 4 \(KES 600.00\)/);
});
