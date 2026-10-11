import assert from 'node:assert/strict';
import test from 'node:test';
import { answerInput, answerPrompt, parsePlan, planPrompt, previousMonth, questionsFor, resolveMonth, resolvePeriod, topicName } from './aiQuestions.ts';

const TODAY = '2026-10-10';

test('named periods resolve against the organization\'s today', () => {
  assert.deepEqual(resolvePeriod('this_month', TODAY), { range: '2026-10', from: '2026-10-01', to: '2026-10-31', label: 'October 2026 so far' });
  assert.deepEqual(resolvePeriod('last month', TODAY), { range: '2026-09', from: '2026-09-01', to: '2026-09-30', label: 'September 2026' });
  assert.deepEqual(resolvePeriod('this_quarter', TODAY), { range: 'Q4 2026', from: '2026-10-01', to: '2026-12-31', label: 'Q4 2026 so far' });
  assert.equal(resolvePeriod('last_quarter', TODAY)?.range, 'Q3 2026');
  assert.deepEqual(resolvePeriod('this_year', TODAY), { range: 'this year-to-date', from: '2026-01-01', to: TODAY, label: '1 January to 10 October 2026' });
  assert.deepEqual(resolvePeriod('last_year', TODAY), { range: 'last year', from: '2025-01-01', to: '2025-12-31', label: '2025' });
});

test('January and the first quarter look back into the year before', () => {
  assert.equal(resolvePeriod('last_month', '2026-01-15')?.range, '2025-12');
  assert.deepEqual(resolvePeriod('last_quarter', '2026-02-01'), { range: 'Q4 2025', from: '2025-10-01', to: '2025-12-31', label: 'Q4 2025' });
});

test('months and quarters may be named exactly, but not in the future', () => {
  assert.equal(resolvePeriod('2026-08', TODAY)?.label, 'August 2026');
  assert.equal(resolvePeriod('Q2_2026', TODAY)?.range, 'Q2 2026');
  assert.equal(resolvePeriod('2026_q1', TODAY)?.range, 'Q1 2026');
  assert.equal(resolvePeriod('2026-11', TODAY), null);
  assert.equal(resolvePeriod('Q1_2027', TODAY), null);
  assert.equal(resolvePeriod('2026-13', TODAY), null);
  assert.equal(resolvePeriod('yesterday', TODAY), null);
  assert.equal(resolvePeriod(7, TODAY), null);
});

test('a month is a single month only', () => {
  assert.equal(resolveMonth('last_month', TODAY), '2026-09');
  assert.equal(resolveMonth('this_quarter', TODAY), null);
  assert.equal(previousMonth('2026-01'), '2025-12');
  assert.equal(previousMonth('2026-10'), '2026-09');
});

test('the model\'s choice is checked against the questions for the edition', () => {
  assert.deepEqual(parsePlan({ question: 'profit_and_loss', args: { period: 'last_month' } }, 'business', TODAY), {
    question: 'profit_and_loss', args: { period: { range: '2026-09', from: '2026-09-01', to: '2026-09-30', label: 'September 2026' } }, language: 'en',
  });
  assert.equal(parsePlan({ question: 'none' }, 'business', TODAY), null);
  assert.equal(parsePlan({ question: 'drop_tables' }, 'business', TODAY), null);
  assert.equal(parsePlan({ question: 'top_items' }, 'church', TODAY), null, 'sales by item is not a church question');
  assert.equal(parsePlan({ question: 'work_in_progress' }, 'business', TODAY), null, 'unbilled work is a law question');
  assert.equal(parsePlan(null, 'business', TODAY), null);
});

test('arguments the model gets wrong fall back to the defaults', () => {
  const plan = parsePlan({ question: 'top_customers', args: { period: 'the dawn of time', limit: 500 } }, 'business', TODAY)!;
  assert.equal(plan.args.period?.range, '2026-10');
  assert.equal(plan.args.limit, 10);
  const late = parsePlan({ question: 'overdue_invoices', args: { min_days: '30' } }, 'law', TODAY)!;
  assert.equal(late.args.min_days, 30);
  const months = parsePlan({ question: 'compare_months', args: { month: 'Q3_2026' } }, 'church', TODAY)!;
  assert.equal(months.args.month, '2026-10');
});

test('the planning prompt lists only the edition\'s questions', () => {
  const church = planPrompt('church', TODAY);
  assert.match(church, /fund_balances/);
  assert.doesNotMatch(church, /top_items|work_in_progress/);
  assert.match(planPrompt('law', TODAY), /client_money/);
  assert.ok(questionsFor('business').length >= 10);
});

test('the model is given the question, the totals and at most 25 rows', () => {
  const text = answerInput('Who owes us?', {
    title: 'Who owes us', scope: 'today', columns: ['Customer', 'Owed (KES)'],
    rows: Array.from({ length: 40 }, (_, i) => [`Customer ${i + 1}`, '1,000.00']), facts: ['Total owed: KES 40,000.00'],
  });
  assert.match(text, /^Question: Who owes us\?/);
  assert.match(text, /- Total owed: KES 40,000.00/);
  assert.match(text, /Customer 25 \| 1,000.00/);
  assert.doesNotMatch(text, /Customer 26/);
  assert.match(answerInput('x', { title: 't', scope: 's', columns: ['a'], rows: [], facts: [] }), /Rows: none/);
});

test('topics are named in lower case, except an abbreviation that opens them', () => {
  assert.equal(topicName('cash_position'), 'money in bank, M-Pesa and cash');
  assert.equal(topicName('vat_position'), 'VAT for the period');
});

test('the answer is written in the language the question was asked in', () => {
  assert.equal(parsePlan({ question: 'who_owes_us', language: 'sw' }, 'business', TODAY)?.language, 'sw');
  assert.equal(parsePlan({ question: 'who_owes_us', language: 'fr' }, 'business', TODAY)?.language, 'en');
  assert.match(answerPrompt('sw'), /Kiswahili/);
  assert.match(answerPrompt('sw'), /imepita tarehe ya kulipwa/);
  // English answers are not given the Kiswahili words, which one model then used in English.
  assert.doesNotMatch(answerPrompt('en'), /Kiswahili|imepita/);
});
