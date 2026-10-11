import type { Context } from 'hono';
import { AskService } from '../../src/server/aiAssistant';
import { ReceiptReaderService } from '../../src/server/aiReceipts';
import { BankSuggestionService } from '../../src/server/aiBanking';
import { DraftService } from '../../src/server/aiDrafts';
import { WorkersAiService, type AiCaller } from '../../src/server/workersAi';
import { assertLawEdition } from '../../src/server/lawAccess';
import { assertChurchEdition } from '../../src/server/churchAccess';
import type { AiBinding } from '../../src/utils/workersAi';
import { bodyOf, DAY, enforceRateLimits, HOUR, respondError } from '../http';
import {
  askSchema, feeNoteNarrativeSchema, receiptScanSchema, reminderDraftSchema, transcribeSchema, treasurerRemarksSchema,
} from '../schemas';
import type { Variables } from '../auth';
import type { Api } from './types';

/** Who is asking, and the Worker's Workers AI binding (wrangler.jsonc "ai"). */
const callerOf = (c: Context<{ Variables: Variables }>): AiCaller => ({
  ai: (c.env as { AI?: AiBinding } | undefined)?.AI,
  orgId: c.get('orgId'),
  userId: c.get('userId'),
});

/** Per person and per organization; the daily ceiling in Neurons is checked as well (WorkersAiService). */
const limits = (c: Context<{ Variables: Variables }>, name: string, perHour: number, perDay: number) => enforceRateLimits(
  [
    { key: `${name}:user:${c.get('userId')}`, limit: perHour, windowSeconds: HOUR },
    { key: `${name}:org:${c.get('orgId')}`, limit: perDay, windowSeconds: DAY },
  ],
  'That is as much of this as can be done for now. Try again later.',
);

/**
 * The AI features, on Cloudflare Workers AI. Each needs the organization's
 * consent (organizations.ai_enabled), is rate limited, and suggests or
 * drafts only: a person checks the result before anything is saved or sent.
 */
export function registerAiRoutes(api: Api) {
  api.post('/expenses/scan', async (c) => {
    try {
      const body = receiptScanSchema.parse(await bodyOf(c));
      await limits(c, 'scan', 30, 300);
      return c.json(await ReceiptReaderService.read(callerOf(c), (body.image || body.imageBase64)!, body.mimeType));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/ai/ask', async (c) => {
    try {
      const body = askSchema.parse(await bodyOf(c));
      await limits(c, 'ask', 30, 300);
      return c.json(await AskService.ask(callerOf(c), body.question));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/ai/transcribe', async (c) => {
    try {
      const body = transcribeSchema.parse(await bodyOf(c));
      await limits(c, 'voice', 30, 300);
      return c.json({ text: await AskService.transcribe(callerOf(c), body.audio) });
    } catch (err) { return respondError(c, err); }
  });

  api.post('/ai/bank-suggestions', async (c) => {
    try {
      await limits(c, 'bank', 20, 100);
      return c.json(await BankSuggestionService.suggest(callerOf(c)));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/ai/invoice-reminder', async (c) => {
    try {
      const body = reminderDraftSchema.parse(await bodyOf(c));
      await limits(c, 'draft', 40, 300);
      return c.json(await DraftService.invoiceReminder(callerOf(c), body.invoiceId, body.language));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/ai/fee-note-narrative', async (c) => {
    try {
      const body = feeNoteNarrativeSchema.parse(await bodyOf(c));
      await assertLawEdition(c.get('orgId'));
      await limits(c, 'draft', 40, 300);
      return c.json(await DraftService.feeNoteNarrative(callerOf(c), body.matterId, body.timeEntryIds, body.disbursementIds));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/ai/treasurer-remarks', async (c) => {
    try {
      const body = treasurerRemarksSchema.parse(await bodyOf(c));
      await assertChurchEdition(c.get('orgId'));
      await limits(c, 'draft', 40, 300);
      return c.json(await DraftService.treasurerRemarks(callerOf(c), body.month, body.language));
    } catch (err) { return respondError(c, err); }
  });

  api.get('/ai/usage', async (c) => {
    try {
      const since = `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`;
      return c.json(await WorkersAiService.usage(c.get('orgId'), since));
    } catch (err) { return respondError(c, err); }
  });
}
