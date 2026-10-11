import assert from 'node:assert/strict';
import test from 'node:test';
import { bankSuggestionInput, parseBankSuggestions, postableForAi, type AccountForAi, type BankLineForAi } from './aiBank.ts';

const lines: BankLineForAi[] = [
  { id: 'line-a', date: '2026-09-20', description: 'KPLC TOKENS 54123987', amountCents: 300_000, direction: 'OUT' },
  { id: 'line-b', date: '2026-09-21', description: 'MPESA FROM JOHN KAMAU 0712345678', amountCents: 150_000, direction: 'IN' },
  { id: 'line-c', date: '2026-09-22', description: null, amountCents: 5_000, direction: 'OUT' },
];
const accounts: AccountForAi[] = [
  { id: 'acc-power', code: '6200', name: 'Electricity and water', type: 'EXPENSE' },
  { id: 'acc-sales', code: '4000', name: 'Sales', type: 'INCOME' },
  { id: 'acc-loan', code: '2500', name: 'Director loan', type: 'LIABILITY' },
];

test('suggestions name a line by its number and an account by its code', () => {
  const found = parseBankSuggestions({
    suggestions: [
      { line: 1, code: '6200', reason: 'KPLC is electricity!' },
      { line: 2, code: 4000, reason: 'Money received from a customer' },
    ],
  }, lines, accounts);
  assert.deepEqual(found, [
    { transactionId: 'line-a', accountId: 'acc-power', code: '6200', name: 'Electricity and water', reason: 'KPLC is electricity.' },
    { transactionId: 'line-b', accountId: 'acc-sales', code: '4000', name: 'Sales', reason: 'Money received from a customer' },
  ]);
});

test('a suggestion for a line or account that does not exist is dropped', () => {
  assert.deepEqual(parseBankSuggestions({ suggestions: [{ line: 9, code: '6200' }, { line: 0, code: '6200' }, { line: 1, code: '9999' }] }, lines, accounts), []);
  assert.deepEqual(parseBankSuggestions({ suggestions: 'none' }, lines, accounts), []);
  assert.deepEqual(parseBankSuggestions(null, lines, accounts), []);
});

test('money out never goes to income, and money in never to an expense', () => {
  const found = parseBankSuggestions({ suggestions: [{ line: 1, code: '4000' }, { line: 2, code: '6200' }, { line: 2, code: '2500' }] }, lines, accounts);
  assert.deepEqual(found.map((s) => [s.transactionId, s.code]), [['line-b', '2500']]);
});

test('only the first suggestion for a line counts', () => {
  const found = parseBankSuggestions({ suggestions: [{ line: 1, code: '6200' }, { line: 1, code: '2500' }] }, lines, accounts);
  assert.deepEqual(found.map((s) => s.code), ['6200']);
});

test('the model chooses from accounts a line may post to', () => {
  const chart = postableForAi([
    { id: '1', code: '1000', name: 'Bank', type: 'ASSET', isBankAccount: true },
    { id: '2', code: '1010', name: 'M-Pesa till', type: 'ASSET', isBankAccount: true },
    { id: '3', code: '1100', name: 'Receivables', type: 'ASSET' },
    { id: '4', code: '1150', name: 'VAT recoverable', type: 'ASSET' },
    { id: '5', code: '2000', name: 'Payables', type: 'LIABILITY' },
    { id: '6', code: '6200', name: 'Electricity', type: 'EXPENSE' },
    { id: '7', code: '6300', name: 'Old account', type: 'EXPENSE', isActive: false },
    { id: '8', code: '1500', name: 'Equipment', type: 'ASSET' },
  ]);
  assert.deepEqual(chart.map((a) => a.code), ['6200', '1500']);
});

test('the model sees numbered lines without their ids or phone numbers', () => {
  const text = bankSuggestionInput(lines, accounts, 'KES');
  assert.match(text, /6200 \| Electricity and water \| EXPENSE/);
  assert.match(text, /1 \| 2026-09-20 \| money out \| KES 3,000.00 \| KPLC TOKENS 54123987/);
  assert.match(text, /2 \| 2026-09-21 \| money in \| KES 1,500.00 \| MPESA FROM JOHN KAMAU \[phone\]/);
  assert.match(text, /3 \| 2026-09-22 \| money out \| KES 50.00 \| \(no particulars\)/);
  assert.doesNotMatch(text, /line-a|0712345678/);
});
