/**
 * Shared handling of Cloudflare Workers AI results, kept free of Worker and
 * database imports so it can be tested on its own.
 */

/** The Worker's AI binding (wrangler.jsonc "ai"), as far as this app uses it. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/** The models each job runs on. Chosen by testing; see the pull request that added them. */
export const AI_MODELS = {
  /** Choosing a report for a question and suggesting accounts: replies in JSON. The model County Yangu runs on. */
  text: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  /**
   * Prose for people: answers and drafts, in English or Kiswahili. Its
   * Kiswahili read naturally where Llama 3.3's did not, at about a fifth of
   * the cost. Run with thinking off (WRITER_OPTIONS).
   */
  writer: '@cf/google/gemma-4-26b-a4b-it',
  /** Receipt photos: 18 of 18 test receipts read correctly, including real photographed ones. */
  vision: '@cf/mistralai/mistral-small-3.1-24b-instruct',
  /** Spoken questions. */
  speech: '@cf/openai/whisper-large-v3-turbo',
} as const;

/** Gemma 4 thinks before answering unless told not to, which spends the reply's tokens on reasoning. */
export const WRITER_OPTIONS = { chat_template_kwargs: { enable_thinking: false } } as const;

/**
 * The text of a model's reply. Workers AI returns OpenAI-style choices, and
 * also a `response` field that it hands back already parsed when the reply
 * is JSON, so an object there is turned back into text.
 */
export function aiText(result: unknown): string {
  const r = (result ?? {}) as any;
  const content = r?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;
  if (typeof r.response === 'string') return r.response;
  if (r.response && typeof r.response === 'object') return JSON.stringify(r.response);
  if (typeof r.text === 'string') return r.text;
  return '';
}

export interface AiUsage {
  tokensIn: number;
  tokensOut: number;
  /** Cloudflare's billing unit; 10,000 a day are free. */
  neurons: number;
}

export function aiUsage(result: unknown): AiUsage {
  const usage = ((result ?? {}) as any).usage ?? {};
  const count = (value: unknown) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0);
  return { tokensIn: Math.round(count(usage.prompt_tokens)), tokensOut: Math.round(count(usage.completion_tokens)), neurons: count(usage.neurons) };
}

/** The first JSON object in a reply, or null when there is none. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export type AiFailure = 'allowance' | 'capacity' | 'plan' | 'other';

/**
 * Sorts a Workers AI error by its internal code
 * (developers.cloudflare.com/workers-ai/platform/errors/).
 */
export function aiFailureKind(err: unknown): AiFailure {
  const message = String((err as any)?.message ?? err ?? '');
  if (/\b3036\b|daily free allocation/i.test(message)) return 'allowance';
  if (/\b3040\b|capacity temporarily exceeded|out of capacity/i.test(message)) return 'capacity';
  if (/\b5035\b|not available on the Workers Free plan/i.test(message)) return 'plan';
  return 'other';
}

export const AI_FAILURE_MESSAGES: Record<AiFailure, string> = {
  allowance: 'The AI allowance for today is used up. It renews at 03:00 Nairobi time; everything else in Ledger Link works as usual.',
  capacity: 'The AI service is busy. Try again in a minute.',
  plan: 'This AI model needs the Cloudflare Workers Paid plan.',
  other: 'The AI service did not answer. Try again in a minute.',
};

const PERSONAL_DETAILS: Array<[RegExp, string]> = [
  // Kenyan mobile numbers: 07xx, 01xx and +254 forms, with or without spaces.
  [/(?<![\d])(?:\+?254[\s.-]?|0)[17](?:[\s.-]?\d){8}(?!\d)/g, '[phone]'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  [/\b((?:national\s+)?(?:id|identity)(?:\s*(?:no\.?|number|card))?\s*[:#-]?\s*)\d{7,9}\b/gi, '$1[id number]'],
];

/** Removes phone numbers, email addresses and ID numbers before text leaves for the model. */
export function redactPersonal(text: string): string {
  return PERSONAL_DETAILS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);
}

/**
 * Model prose made to fit the house style: no exclamation marks, no
 * Markdown emphasis, no stray surrounding quotes, trimmed to a length.
 */
export function plainProse(text: string, maxLength = 1200): string {
  let value = text.trim()
    .replace(/^```[a-z]*\s*|\s*```$/gi, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,;:])/g, '$1$2')
    .replace(/!+/g, '.')
    .replace(/\.{2,}/g, '.')
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim();
  if (value.length > maxLength) {
    const cut = value.slice(0, maxLength);
    const lastStop = cut.lastIndexOf('.');
    value = lastStop > maxLength * 0.6 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
  }
  return value;
}

/** Hundredths from an amount in the main unit, or null when it is not a usable number. */
export function centsFromMajor(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''));
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000_000) return null;
  return Math.round(number * 100);
}
