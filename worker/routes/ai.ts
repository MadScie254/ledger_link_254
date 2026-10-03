import { GeminiService } from '../../src/server/gemini';
import { AIInsightsService } from '../../src/server/aiInsights';
import { OrganizationService } from '../../src/server/organizations';
import { bodyOf, DAY, enforceRateLimits, HOUR, respondError, UserError } from '../http';
import { askSchema, receiptScanSchema } from '../schemas';
import type { Api } from './types';

const AI_OFF = 'AI features are off for this organization. An owner or administrator can turn them on in Settings; receipts and summary figures are then sent to Google Gemini.';

/**
 * The two Gemini features. Each needs the organization's consent
 * (organizations.ai_enabled) and is rate limited per person and per
 * organization, because every call costs money.
 */
export function registerAiRoutes(api: Api) {
  api.post('/expenses/scan', async (c) => {
    try {
      const body = receiptScanSchema.parse(await bodyOf(c));
      if (!(await OrganizationService.aiEnabled(c.get('orgId')))) throw new UserError(AI_OFF, 403);
      await enforceRateLimits(
        [
          { key: `scan:user:${c.get('userId')}`, limit: 30, windowSeconds: HOUR },
          { key: `scan:org:${c.get('orgId')}`, limit: 300, windowSeconds: DAY },
        ],
        'That is as many receipts as can be read for now. Try again later, or enter the bill by hand.',
      );
      return c.json(await GeminiService.scanReceipt((body.image || body.imageBase64)!, body.mimeType));
    } catch (err) { return respondError(c, err); }
  });

  api.post('/ai/ask', async (c) => {
    try {
      const body = askSchema.parse(await bodyOf(c));
      if (!(await OrganizationService.aiEnabled(c.get('orgId')))) throw new UserError(AI_OFF, 403);
      await enforceRateLimits(
        [
          { key: `ask:user:${c.get('userId')}`, limit: 30, windowSeconds: HOUR },
          { key: `ask:org:${c.get('orgId')}`, limit: 300, windowSeconds: DAY },
        ],
        'That is as many questions as can be answered for now. Try again later.',
      );
      return c.json({ answer: await AIInsightsService.ask(c.get('orgId'), body.question) });
    } catch (err) { return respondError(c, err); }
  });
}
