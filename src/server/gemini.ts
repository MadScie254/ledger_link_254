import { GoogleGenAI, Type, Schema } from '@google/genai';
import { z } from 'zod';
import { isCalendarDate } from '../utils/dates';

/**
 * What the model returns is treated as untrusted input: text on a receipt
 * can steer it. Every field is checked and clamped here, and a person still
 * reviews the result before anything is saved.
 */
const cents = z.number().int().min(0).max(100_000_000_000).catch(0);
const receiptSchema = z.object({
  vendorName: z.string().trim().max(200).catch(''),
  date: z.string().trim().catch('').transform((value) => (isCalendarDate(value.slice(0, 10)) ? value.slice(0, 10) : null)),
  totalAmountCents: cents,
  taxAmountCents: cents.optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).catch('KES'),
  items: z.array(z.object({
    description: z.string().trim().max(500).catch(''),
    quantity: z.number().min(0).max(1_000_000).optional().catch(undefined),
    unitPriceCents: cents.optional(),
    totalPriceCents: cents,
  })).max(100).catch([]),
});
export type ScannedReceipt = z.infer<typeof receiptSchema>;

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('GEMINI_API_KEY environment variable is missing.');
}

const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key' });

export class GeminiService {
  static async scanReceipt(base64Image: string, mimeType: string): Promise<ScannedReceipt> {
    if (!apiKey) {
      throw new Error('Gemini API key not configured on server.');
    }

    const responseSchema: Schema = {
      type: Type.OBJECT,
      properties: {
        vendorName: { type: Type.STRING },
        date: { type: Type.STRING, description: "ISO 8601 date string" },
        totalAmountCents: { type: Type.INTEGER, description: "Total amount in cents (e.g. 10.50 -> 1050)" },
        taxAmountCents: { type: Type.INTEGER, description: "Tax amount in cents" },
        currency: { type: Type.STRING, description: "3-letter currency code, e.g. KES or USD" },
        items: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              description: { type: Type.STRING },
              quantity: { type: Type.NUMBER },
              unitPriceCents: { type: Type.INTEGER },
              totalPriceCents: { type: Type.INTEGER }
            },
            required: ['description', 'totalPriceCents']
          }
        }
      },
      required: ['vendorName', 'totalAmountCents', 'currency']
    };

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro',
      contents: [
        {
          role: 'user',
          parts: [
            { text: 'Extract receipt information from this image into structured JSON.' },
            {
              inlineData: {
                data: base64Image.replace(/^data:image\/\w+;base64,/, ''),
                mimeType
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema,
        temperature: 0.1
      }
    });

    const text = response.text;
    if (!text) throw new Error('No text received from Gemini');

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('The receipt could not be read.');
    }
    const result = receiptSchema.safeParse(parsed);
    if (!result.success) throw new Error('The receipt could not be read.');
    return result.data;
  }
}
