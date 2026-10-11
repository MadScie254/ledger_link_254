// The AI features through their services and PostgREST, with a scripted
// stand-in for the Workers AI binding: consent and ceilings are enforced,
// questions are answered from the organization's own books, suggestions and
// drafts are built from the right records, and every call is recorded.
import assert from 'node:assert/strict';
import test from 'node:test';
import { AskService } from '../../src/server/aiAssistant';
import { ReceiptReaderService } from '../../src/server/aiReceipts';
import { BankSuggestionService } from '../../src/server/aiBanking';
import { DraftService } from '../../src/server/aiDrafts';
import { WorkersAiService } from '../../src/server/workersAi';
import { InvoiceService } from '../../src/server/invoices';
import { OrganizationService } from '../../src/server/organizations';
import { CustomerService } from '../../src/server/customers';
import { MatterService } from '../../src/server/matters';
import { DisbursementService } from '../../src/server/disbursements';
import { GivingService } from '../../src/server/giving';
import { AI_MODELS, type AiBinding } from '../../src/utils/workersAi';
import { ORG, OWNER, CUSTOMER, SALES, sql, uuid, refused } from './helpers';

const calls: Array<{ model: string; input: any }> = [];
const replies: unknown[] = [];
const ai: AiBinding = {
  async run(model, input) {
    calls.push({ model, input });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  },
};
const reply = (content: unknown, neurons = 12.5) => ({
  choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
  usage: { prompt_tokens: 400, completion_tokens: 40, neurons },
});
const caller = (orgId = ORG) => ({ ai, orgId, userId: OWNER });
const sentToModel = () => {
  const messages = calls.at(-1)!.input.messages as Array<{ content: unknown }>;
  const last = messages.at(-1)!.content;
  return typeof last === 'string' ? last : JSON.stringify(last);
};
const logged = (orgId: string, where = 'true') => Number(sql(`SELECT count(*) FROM private.ai_calls WHERE org_id = '${orgId}' AND ${where}`));

test('AI stays off until the organization allows it, and needs the binding', async () => {
  await refused(AskService.ask(caller(), 'How are we doing?'), /AI features are off/);
  sql(`UPDATE public.organizations SET ai_enabled = true, payment_details = 'M-Pesa Paybill 123456, account INV' WHERE id = '${ORG}'`);
  await refused(AskService.ask({ ai: undefined, orgId: ORG, userId: OWNER }, 'How are we doing?'), /not set up/);
  assert.equal(calls.length, 0, 'nothing reached the model');
});

let invoiceId = '';

test('a question is answered from the books, with the rows it was written from', async () => {
  invoiceId = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-08-01', dueDate: '2026-08-31', currency: 'KES',
    lines: [{ description: 'Cement', accountId: SALES, amountCents: 80_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  replies.push(reply({ question: 'who_owes_us', args: { limit: 5 } }), reply('Acme owes KES 800.00, all of it overdue!'));

  const answer = await AskService.ask(caller(), 'Who owes us money? Call me on 0712345678');
  assert.equal(answer.question, 'who_owes_us');
  assert.equal(answer.answer, 'Acme owes KES 800.00, all of it overdue.', 'no exclamation marks');
  assert.deepEqual(answer.columns, ['Customer', 'Owed (KES)', 'Overdue (KES)', 'Oldest, days late']);
  assert.equal(answer.rows![0][0], 'Acme');
  assert.equal(answer.rows![0][1], '800.00');

  const [plan, explain] = calls.slice(-2);
  assert.equal(plan.model, AI_MODELS.text);
  assert.equal(explain.model, AI_MODELS.writer);
  assert.deepEqual(explain.input.chat_template_kwargs, { enable_thinking: false });
  assert.doesNotMatch(JSON.stringify(plan.input), /0712345678/, 'the phone number never left');
  assert.match(explain.input.messages[1].content, /Total owed: KES 800.00/);
  assert.equal(logged(ORG, `feature IN ('ask.plan', 'ask.answer') AND ok`), 2);
});

test('a plan Workers AI hands back already parsed still routes (the County Yangu failure)', async () => {
  replies.push({ response: { question: 'profit_and_loss', args: { period: '2026-08' } }, usage: { neurons: 3 } }, reply('Sales were KES 800.00 in August.'));
  const answer = await AskService.ask(caller(), 'What was our profit in August?');
  assert.equal(answer.question, 'profit_and_loss');
  assert.equal(answer.scope, 'August 2026');
  assert.ok(answer.rows!.some((row) => row[0] === 'Sales' && row[2] === '800.00'));
});

test('when the writer model comes back empty, the text model writes the answer', async () => {
  replies.push(reply({ question: 'who_owes_us', language: 'sw' }), reply(''), reply('Acme ina deni la KES 800.00.'));
  const answer = await AskService.ask(caller(), 'Ni nani anatudai?');
  assert.equal(answer.answer, 'Acme ina deni la KES 800.00.');
  const [plan, writer, fallback] = calls.slice(-3);
  assert.deepEqual([plan.model, writer.model, fallback.model], [AI_MODELS.text, AI_MODELS.writer, AI_MODELS.text]);
  assert.match(fallback.input.messages[0].content, /Kiswahili/);
  assert.equal(fallback.input.chat_template_kwargs, undefined);
});

test('a question the books cannot answer lists the topics without a second call', async () => {
  const before = calls.length;
  replies.push(reply({ question: 'none' }));
  const answer = await AskService.ask(caller(), 'What will the weather be tomorrow?');
  assert.equal(answer.question, null);
  assert.match(answer.answer, /^That is not a question the books can answer yet/);
  assert.equal(calls.length, before + 1);
});

test('the daily allowance running out is explained, and the failed call recorded', async () => {
  replies.push(new Error('3036: You have used up your daily free allocation of 10,000 neurons.'));
  await refused(AskService.ask(caller(), 'How are we doing?'), /renews at 03:00 Nairobi time/);
  assert.equal(logged(ORG, `feature = 'ask.plan' AND NOT ok`), 1);
});

test('an organization that has used its own ceiling is refused before the model is called', async () => {
  const before = calls.length;
  process.env.AI_DAILY_UNITS_PER_ORG = '10';
  try {
    await refused(AskService.ask(caller(), 'How are we doing?'), /used its AI allowance for today/);
  } finally {
    delete process.env.AI_DAILY_UNITS_PER_ORG;
  }
  assert.equal(calls.length, before);
});

test('a receipt photo is read by the vision model into hundredths', async () => {
  replies.push(reply({ vendorName: 'Kilima Energy Service Station', date: '2026-09-21', total: 5512.76, tax: 760.38, currency: 'KSh', items: [] }));
  const receipt = await ReceiptReaderService.read(caller(), 'iVBORw0KGgo'.repeat(20), 'image/jpeg');
  assert.deepEqual([receipt.totalAmountCents, receipt.taxAmountCents, receipt.currency, receipt.date], [551_276, 76_038, 'KES', '2026-09-21']);
  const call = calls.at(-1)!;
  assert.equal(call.model, AI_MODELS.vision);
  assert.match(call.input.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,iVBOR/);

  replies.push(reply('I cannot see a receipt.'));
  await refused(ReceiptReaderService.read(caller(), 'iVBORw0KGgo'.repeat(20), 'image/jpeg'), /could not be read/);
});

test('statement lines get account suggestions stored on them, and are sent once', async () => {
  const [a, b] = [uuid(), uuid()];
  sql(`INSERT INTO public.bank_transactions (id, org_id, date, description, amount_cents, direction) VALUES
    ('${a}', '${ORG}', '2026-09-23', 'SAFARICOM AIRTIME', 100000, 'OUT'),
    ('${b}', '${ORG}', '2026-09-22', 'MPESA FROM JOHN KAMAU 0712345678', 250000, 'IN')`);
  // Newest first: 1 = airtime, 2 = the M-Pesa receipt, 3 = KPLC tokens, 4 = the fixture's M-Pesa line.
  replies.push(reply({ suggestions: [
    { line: 1, code: '6000', reason: 'Airtime is an operating expense' },
    { line: 2, code: '4000', reason: 'Money from a customer' },
    { line: 3, code: '4000', reason: 'Wrong direction, dropped' },
  ] }));

  const result = await BankSuggestionService.suggest(caller());
  assert.equal(result.considered, 4);
  assert.deepEqual(result.suggestions.map((s) => s.code), ['6000', '4000']);
  assert.doesNotMatch(sentToModel(), /0712345678|b1|b2/);
  assert.equal(sql(`SELECT ai_category_code FROM public.bank_transactions WHERE id = '${a}'`), '6000');
  assert.equal(sql(`SELECT ai_category_name FROM public.bank_transactions WHERE id = '${b}'`), 'Sales');
  assert.equal(sql(`SELECT ai_category_code FROM public.bank_transactions WHERE id = '00000000-0000-0000-0000-0000000000b2'`), '', 'a line the model left out is marked looked at');

  const before = calls.length;
  const again = await BankSuggestionService.suggest(caller());
  assert.equal(again.considered, 0);
  assert.equal(calls.length, before, 'nothing was sent a second time');
});

test('a payment reminder is drafted from the invoice, and refused when nothing is owed', async () => {
  replies.push(reply('Dear Acme, invoice INV is overdue. Please pay!'));
  const draft = await DraftService.invoiceReminder(caller(), invoiceId, 'sw');
  assert.equal(draft.text, 'Dear Acme, invoice INV is overdue. Please pay.');
  assert.match(calls.at(-1)!.input.messages[0].content, /Kiswahili/);
  const facts = sentToModel();
  assert.match(facts, /Customer: Acme/);
  assert.match(facts, /Still owed: KES 800.00/);
  assert.match(facts, /How to pay: M-Pesa Paybill 123456, account INV/);

  const paid = await InvoiceService.createInvoice({
    orgId: ORG, customerId: CUSTOMER, issueDate: '2026-09-01', dueDate: '2026-09-30', currency: 'KES',
    lines: [{ description: 'Delivery', accountId: SALES, amountCents: 10_000 }], idempotencyKey: uuid(), createdBy: OWNER,
  });
  await InvoiceService.receivePayment(ORG, paid, { amountCents: 10_000, paymentDate: '2026-09-15', depositAccountId: '00000000-0000-0000-0000-00000000a000', idempotencyKey: uuid(), createdBy: OWNER } as any);
  const before = calls.length;
  await refused(DraftService.invoiceReminder(caller(), paid, 'en'), /nothing owing/);
  assert.equal(calls.length, before);
});

test('a fee note narrative is drafted from the chosen work of that matter only', async () => {
  const lawOrg = await OrganizationService.createOrganization({ name: 'Wakili & Co Advocates', country: 'Kenya', edition: 'law' } as any, OWNER);
  sql(`UPDATE public.organizations SET ai_enabled = true WHERE id = '${lawOrg}'`);
  const client = await CustomerService.createCustomer(lawOrg, { displayName: 'Achieng Otieno' } as any);
  const matter = await MatterService.create(lawOrg, OWNER, {
    title: 'Otieno v Kamau, land dispute', clientId: client, matterType: 'LITIGATION', billingMethod: 'HOURLY', defaultRateCents: 1_500_000, openedOn: '2026-10-01',
  });
  const chosen = await MatterService.logTime(lawOrg, matter, OWNER, { entryDate: '2026-10-02', hours: 2.5, description: 'Drafting plaint', billable: true });
  await MatterService.logTime(lawOrg, matter, OWNER, { entryDate: '2026-10-03', hours: 1, description: 'Attending client conference', billable: true });
  await DisbursementService.recordOffice(lawOrg, OWNER, {
    matterId: matter, amountCents: 200_000, incurredOn: '2026-10-05', description: 'Search fees, Ardhisasa',
    paidFromAccountId: sql(`SELECT id FROM public.accounts WHERE org_id = '${lawOrg}' AND code = '1000'`), idempotencyKey: uuid(),
  });
  const disbursement = sql(`SELECT id FROM public.disbursements WHERE org_id = '${lawOrg}' AND matter_id = '${matter}'`);
  const chosenId = typeof chosen === 'string' ? chosen : (chosen as any).id;

  replies.push(reply('To professional services rendered in drafting the plaint!'));
  const narrative = await DraftService.feeNoteNarrative(caller(lawOrg), matter, [chosenId, uuid()], [disbursement]);
  assert.equal(narrative.text, 'To professional services rendered in drafting the plaint.');
  const facts = sentToModel();
  assert.match(facts, /Otieno v Kamau, land dispute/);
  assert.match(facts, /2026-10-02: Drafting plaint/);
  assert.doesNotMatch(facts, /client conference/, 'work not chosen is left out');
  assert.match(facts, /2026-10-05: Search fees, Ardhisasa/);

  await refused(DraftService.feeNoteNarrative(caller(lawOrg), matter, [], []), /Choose the time entries/);
  await refused(DraftService.feeNoteNarrative(caller(ORG), matter, [chosenId], []), /Matter not found/);
});

test("the treasurer's remarks are drafted from the month and the month before", async () => {
  const church = await OrganizationService.createOrganization({ name: 'Kanisa la Majaribio', country: 'Kenya', edition: 'church' } as any, OWNER);
  sql(`UPDATE public.organizations SET ai_enabled = true WHERE id = '${church}'`);
  await GivingService.recordGift(church, OWNER, {
    memberId: null, fundId: sql(`SELECT id FROM public.funds WHERE org_id = '${church}' AND code = 'GENERAL'`), amountCents: 500_000, method: 'CHEQUE', receivedOn: '2026-10-04', idempotencyKey: uuid(),
  } as any);
  replies.push(reply('Income for October 2026 was KES 5,000.00.'));
  const remarks = await DraftService.treasurerRemarks(caller(church), '2026-10', 'en');
  assert.equal(remarks.text, 'Income for October 2026 was KES 5,000.00.');
  const facts = sentToModel();
  assert.match(facts, /Church: Kanisa la Majaribio/);
  assert.match(facts, /Income: KES 5,000.00/);
  assert.match(facts, /Previous month \(September 2026\): income KES 0.00/);
});

test('usage is reported by feature, with what is left of today', async () => {
  const usage = await WorkersAiService.usage(ORG, '2026-01-01T00:00:00Z');
  const features = Object.fromEntries(usage.features.map((f) => [f.feature, f]));
  assert.equal(features['ask.plan'].failed, 1);
  assert.ok(features['receipt.read'].calls >= 2);
  assert.equal(features['bank.suggest'].calls, 1);
  assert.ok(usage.unitsLeftToday < usage.dailyUnits);
});
