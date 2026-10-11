import assert from 'node:assert/strict';
import test from 'node:test';
import { aiFailureKind, aiText, aiUsage, centsFromMajor, parseJsonObject, plainProse, redactPersonal } from './workersAi.ts';

test('a reply is read from the chat choice first, then from response', () => {
  assert.equal(aiText({ choices: [{ message: { content: 'From the choice' } }], response: 'ignored' }), 'From the choice');
  assert.equal(aiText({ response: 'Plain response' }), 'Plain response');
  assert.equal(aiText({ text: 'Spoken words' }), 'Spoken words');
  assert.equal(aiText(null), '');
});

test('a JSON reply that Workers AI hands back already parsed is turned back into text', () => {
  // The County Yangu failure: response was an object, and a check for a string refused it.
  const text = aiText({ choices: [{ message: { content: '' } }], response: { question: 'cash_position', args: {} } });
  assert.deepEqual(parseJsonObject(text), { question: 'cash_position', args: {} });
});

test('usage counts tokens and Neurons, and ignores anything not a positive number', () => {
  assert.deepEqual(aiUsage({ usage: { prompt_tokens: 52, completion_tokens: 12, neurons: 3.84 } }), { tokensIn: 52, tokensOut: 12, neurons: 3.84 });
  assert.deepEqual(aiUsage({ usage: { prompt_tokens: 'x', neurons: -1 } }), { tokensIn: 0, tokensOut: 0, neurons: 0 });
  assert.deepEqual(aiUsage({}), { tokensIn: 0, tokensOut: 0, neurons: 0 });
});

test('the first JSON object in a reply is found inside fences and prose', () => {
  assert.deepEqual(parseJsonObject('```json\n{"total": 1752.5}\n```'), { total: 1752.5 });
  assert.deepEqual(parseJsonObject('Here it is: {"a": {"b": 1}} done'), { a: { b: 1 } });
  assert.equal(parseJsonObject('no json'), null);
  assert.equal(parseJsonObject('{broken'), null);
  assert.equal(parseJsonObject('[1, 2]'), null);
});

test('Workers AI failures are sorted by their internal codes', () => {
  assert.equal(aiFailureKind(new Error('3036: You have used up your daily free allocation of 10,000 neurons.')), 'allowance');
  assert.equal(aiFailureKind(new Error('3040: Capacity temporarily exceeded, please try again.')), 'capacity');
  assert.equal(aiFailureKind(new Error('5035: Model @cf/moonshotai/kimi-k2.6 is not available on the Workers Free plan.')), 'plan');
  assert.equal(aiFailureKind(new Error('Network connection lost.')), 'other');
});

test('phone numbers, email addresses and ID numbers are removed before text leaves', () => {
  assert.equal(redactPersonal('MPESA FROM JOHN KAMAU 0712345678'), 'MPESA FROM JOHN KAMAU [phone]');
  assert.equal(redactPersonal('Call +254 712 345 678 or 0110 123456'), 'Call [phone] or [phone]');
  assert.equal(redactPersonal('Send to jane.wanjiru@example.co.ke today'), 'Send to [email] today');
  assert.equal(redactPersonal('ID No. 23456789 presented'), 'ID No. [id number] presented');
  // Amounts, dates and references stay.
  assert.equal(redactPersonal('KPLC TOKENS 54123987 KES 3,000.00 2026-09-20'), 'KPLC TOKENS 54123987 KES 3,000.00 2026-09-20');
});

test('model prose keeps to the house style: no exclamation marks or Markdown emphasis', () => {
  assert.equal(plainProse('**Great news!** Profit is up!!'), 'Great news. Profit is up.');
  assert.equal(plainProse('"Quoted reply."'), 'Quoted reply.');
  const long = `${'A sentence here. '.repeat(20)}Tail without a stop`;
  const cut = plainProse(long, 100);
  assert.ok(cut.length <= 101 && cut.endsWith('.'));
});

test('amounts in the main unit become hundredths, and nonsense becomes null', () => {
  assert.equal(centsFromMajor(1752.5), 175250);
  assert.equal(centsFromMajor('1,752.50'), 175250);
  assert.equal(centsFromMajor(0.1 + 0.2), 30);
  assert.equal(centsFromMajor(null), null);
  assert.equal(centsFromMajor('abc'), null);
  assert.equal(centsFromMajor(-5), null);
});
