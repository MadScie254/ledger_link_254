import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectMpesaColumns, missingMpesaFields, readMpesaStatement, splitOtherParty, statementTimeToIso,
} from './mpesaStatement.ts';

// Laid out like an M-Pesa org portal statement export: a few lines about the
// account, then the table. All names and numbers are made up.
const rows = [
  ['Organisation Name:', 'Kanisa la Mfano'],
  ['Time Period:', '01/10/2026 - 31/10/2026'],
  ['Receipt No.', 'Completion Time', 'Initiation Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn', 'Balance', 'Reason Type', 'Other Party Info', 'A/C No.'],
  ['SJK3H2K9QX', '04-10-2026 08:15:22', '04-10-2026 08:15:20', 'Pay Bill from 254712***678 - AMINA WEKESA Acc. 1043', 'Completed', '1,500.00', '', '1,500.00', 'Pay Bill', '254712***678 - AMINA WEKESA', '1043'],
  ['SJK3H2K9QY', '04-10-2026 08:15:22', '04-10-2026 08:15:20', 'Pay Bill Charge', 'Completed', '', '-15.00', '1,485.00', 'Pay Bill Charge', '', ''],
  ['SJK4A1B2C3', '05-10-2026 14:01:00', '05-10-2026 14:00:58', 'Pay Bill from 254700***111 - BARAKA OTIENO Acc. BLD', 'Completed', '2,000.00', '', '3,485.00', 'Pay Bill', '254700***111 - BARAKA OTIENO', 'BLD'],
  ['SJK4A1B2C4', '06-10-2026 10:00:00', '06-10-2026 10:00:00', 'Business Pay Bill Charge', 'Completed', '', '20.00', '3,465.00', 'Pay Bill Charge', '', ''],
  ['SJK4A1B2C5', '07-10-2026 09:00:00', '07-10-2026 09:00:00', 'Withdrawal to bank', 'Completed', '', '3,000.00', '465.00', 'Organization Withdrawal', 'BANK', ''],
  ['SJK4A1B2C6', '08-10-2026 09:00:00', '08-10-2026 09:00:00', 'Pay Bill from 254700***222', 'Failed', '500.00', '', '465.00', 'Pay Bill', '254700***222 - CHEBET', 'TITHE'],
  ['SJK3H2K9QX', '04-10-2026 08:15:22', '', 'repeat', 'Completed', '1,500.00', '', '', '', '', '1043'],
  ['', '', '', '', '', '', '', '', '', '', ''],
  ['Total', '', '', '', '', '3,500.00', '3,035.00', '', '', '', ''],
];

test('the statement table and its columns are found below the account lines', () => {
  const { headerRow, mapping } = detectMpesaColumns(rows);
  assert.equal(headerRow, 2);
  assert.deepEqual(mapping, {
    receipt: 0, completedAt: 1, paidIn: 5, withdrawn: 6, accountRef: 10, otherParty: 9, details: 3, reasonType: 8, status: 4,
    dateFormat: 'DMY',
  });
  assert.deepEqual(missingMpesaFields(mapping!), []);
  assert.deepEqual(missingMpesaFields({ receipt: 0 }), ['Completion time', 'Paid in', "Account number (the giver's reference)"]);
  assert.deepEqual(detectMpesaColumns([['Date', 'Amount']]), { headerRow: 0, mapping: null });
});

test('gifts, charges and the lines that are neither are told apart', () => {
  const { headerRow, mapping } = detectMpesaColumns(rows);
  const read = readMpesaStatement(rows, headerRow, mapping!);
  assert.deepEqual(read.gifts, [
    { transId: 'SJK3H2K9QX', transTime: '2026-10-04T08:15:22+03:00', amountCents: 150_000, billRefNumber: '1043', msisdn: '254712***678', firstName: 'AMINA' },
    { transId: 'SJK4A1B2C3', transTime: '2026-10-05T14:01:00+03:00', amountCents: 200_000, billRefNumber: 'BLD', msisdn: '254700***111', firstName: 'BARAKA' },
  ]);
  assert.deepEqual(read.charges, [
    { transId: 'SJK3H2K9QY', date: '2026-10-04', amountCents: 1_500 },
    { transId: 'SJK4A1B2C4', date: '2026-10-06', amountCents: 2_000 },
  ]);
  assert.equal(read.chargesCents, 3_500);
  assert.equal(read.periodEnd, '2026-10-07');
  assert.deepEqual(read.skipped, [
    { row: 8, reason: 'money out, not giving' },
    { row: 9, reason: 'status Failed, not completed' },
    { row: 10, reason: 'receipt SJK3H2K9QX appears twice' },
    { row: 12, reason: 'no M-Pesa receipt number' },
  ]);
});

test('statement times are read as Nairobi time, with or without seconds or AM/PM', () => {
  assert.equal(statementTimeToIso('2026-10-04 08:15:22', 'YMD'), '2026-10-04T08:15:22+03:00');
  assert.equal(statementTimeToIso('04/10/2026 8:15 PM', 'DMY'), '2026-10-04T20:15:00+03:00');
  assert.equal(statementTimeToIso('04/10/2026 12:05 AM', 'DMY'), '2026-10-04T00:05:00+03:00');
  assert.equal(statementTimeToIso('04/10/2026', 'DMY'), '2026-10-04T00:00:00+03:00');
  assert.equal(statementTimeToIso('not a date', 'DMY'), null);
});

test('the payer is split into the masked number and the name', () => {
  assert.deepEqual(splitOtherParty('254712***678 - AMINA WEKESA'), { msisdn: '254712***678', name: 'AMINA WEKESA' });
  assert.deepEqual(splitOtherParty('BANK'), { msisdn: null, name: 'BANK' });
  assert.deepEqual(splitOtherParty(''), { msisdn: null, name: null });
});
