import { getSupabase } from './supabase';
import { UserError } from './errors';
import { WorkersAiService, type AiCaller } from './workersAi';
import { AI_MODELS } from '../utils/workersAi';
import { RECEIPT_SYSTEM_PROMPT, receiptFromModel, receiptUserPrompt, type ScannedReceipt } from '../utils/aiReceipt';

/** Reads a receipt photo with the vision model; the person checks the result before saving. */
export class ReceiptReaderService {
  static async read(caller: AiCaller, imageBase64: string, mimeType: string): Promise<ScannedReceipt> {
    const ai = await WorkersAiService.assertAvailable(caller);
    const { data, error } = await getSupabase().from('organizations').select('base_currency').eq('id', caller.orgId).maybeSingle();
    if (error) throw error;
    const currency = data?.base_currency || 'KES';
    const image = `data:${mimeType};base64,${imageBase64.replace(/^data:[^,]*,/, '')}`;

    const reply = await WorkersAiService.run(caller, ai, {
      feature: 'receipt.read',
      model: AI_MODELS.vision,
      input: {
        messages: [
          { role: 'system', content: RECEIPT_SYSTEM_PROMPT },
          { role: 'user', content: [{ type: 'text', text: receiptUserPrompt(currency) }, { type: 'image_url', image_url: { url: image } }] },
        ],
        max_tokens: 1200,
        temperature: 0.1,
      },
    });
    const receipt = receiptFromModel(reply.json, currency);
    if (!receipt) throw new UserError('The receipt could not be read. Try a sharper, well-lit photo of the whole receipt.');
    return receipt;
  }
}
