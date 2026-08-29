import { GoogleGenAI, Type, Schema } from '@google/genai';

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.warn('GEMINI_API_KEY environment variable is missing.');
}

const ai = new GoogleGenAI({ apiKey: apiKey || 'dummy-key' });

export class GeminiService {
  static async scanReceipt(base64Image: string, mimeType: string) {
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

    const text = response.text();
    if (!text) throw new Error("No text received from Gemini");

    return JSON.parse(text);
  }
}
