import { getSupabase } from './supabase';
import { UserError } from './errors';
import { OrganizationService } from './organizations';
import {
  AI_FAILURE_MESSAGES, AI_MODELS, WRITER_OPTIONS, aiFailureKind, aiText, aiUsage, parseJsonObject,
  type AiBinding,
} from '../utils/workersAi';

/**
 * Every Workers AI call goes through here: the organization's consent is
 * checked, its daily ceiling is checked, the call is timed and recorded in
 * private.ai_calls (public.log_ai_call), and a Workers AI failure becomes a
 * sentence a person can act on.
 */

const AI_OFF = 'AI features are off for this organization. An owner or administrator can turn them on in Settings, Closing and controls; the figures or text involved are then sent to Cloudflare Workers AI.';

/** One organization's share of the account's 10,000 free Neurons a day. */
const DEFAULT_DAILY_UNITS = 4000;

export interface AiCaller {
  ai: AiBinding | undefined;
  orgId: string;
  userId: string;
}

export interface AiRun {
  feature: string;
  model: string;
  input: Record<string, unknown>;
}

export interface AiReply {
  text: string;
  json: Record<string, unknown> | null;
  neurons: number;
}

export interface AiWrite {
  feature: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
}

function dailyUnits(): number {
  const configured = Number(process.env.AI_DAILY_UNITS_PER_ORG);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DAILY_UNITS;
}

export class WorkersAiService {
  /** Refuses unless AI is on for the organization and some of today's ceiling is left. */
  static async assertAvailable(caller: AiCaller): Promise<AiBinding> {
    if (!caller.ai) throw new UserError('AI is not set up on this server. The Worker needs its Workers AI binding (AI in wrangler.jsonc).', 503);
    if (!(await OrganizationService.aiEnabled(caller.orgId))) throw new UserError(AI_OFF, 403);
    const { data, error } = await getSupabase().rpc('ai_units_left', { p_org_id: caller.orgId, p_daily_units: dailyUnits() });
    if (error) throw error;
    if (Number(data) <= 0) {
      throw new UserError('This organization has used its AI allowance for today. It renews at 03:00 Nairobi time; everything else in Ledger Link works as usual.', 429);
    }
    return caller.ai;
  }

  /** Runs one model call for a caller already checked with assertAvailable. */
  static async run(caller: AiCaller, ai: AiBinding, call: AiRun): Promise<AiReply> {
    const started = Date.now();
    try {
      const result = await ai.run(call.model, call.input);
      const usage = aiUsage(result);
      await this.log(caller, call, true, usage.tokensIn, usage.tokensOut, usage.neurons, Date.now() - started);
      const text = aiText(result);
      return { text, json: parseJsonObject(text), neurons: usage.neurons };
    } catch (err) {
      await this.log(caller, call, false, 0, 0, 0, Date.now() - started);
      const kind = aiFailureKind(err);
      console.error('[AI]', call.feature, call.model, kind, String((err as Error)?.message ?? err).slice(0, 200));
      throw new UserError(AI_FAILURE_MESSAGES[kind], kind === 'plan' ? 503 : kind === 'other' ? 502 : 429);
    }
  }

  /**
   * Prose for people, on the writer model. Should it fail or come back
   * empty, the text model writes it instead; a used-up allowance is not
   * retried, since the second call would fail the same way.
   */
  static async write(caller: AiCaller, ai: AiBinding, call: AiWrite): Promise<AiReply> {
    const messages = [{ role: 'system', content: call.system }, { role: 'user', content: call.user }];
    const temperature = call.temperature ?? 0.3;
    try {
      const reply = await this.run(caller, ai, {
        feature: call.feature, model: AI_MODELS.writer,
        input: { messages, max_tokens: call.maxTokens, temperature, ...WRITER_OPTIONS },
      });
      if (reply.text.trim()) return reply;
    } catch (err) {
      if (err instanceof UserError && err.message === AI_FAILURE_MESSAGES.allowance) throw err;
    }
    return this.run(caller, ai, { feature: call.feature, model: AI_MODELS.text, input: { messages, max_tokens: call.maxTokens, temperature } });
  }

  /** Recording never stops an answer from being returned. */
  private static async log(caller: AiCaller, call: AiRun, ok: boolean, tokensIn: number, tokensOut: number, neurons: number, ms: number) {
    const { error } = await getSupabase().rpc('log_ai_call', {
      p_org_id: caller.orgId, p_user_id: caller.userId, p_feature: call.feature, p_model: call.model.slice(0, 100), p_ok: ok,
      p_tokens_in: tokensIn, p_tokens_out: tokensOut, p_neurons: Math.round(neurons * 1000) / 1000, p_duration_ms: ms,
    });
    if (error) console.error('[AI] usage not recorded:', error.code || '', String(error.message || '').slice(0, 120));
  }

  /** This organization's AI use since the first of the month, by feature, and what is left today. */
  static async usage(orgId: string, since: string) {
    const supabase = getSupabase();
    const [usage, left] = await Promise.all([
      supabase.rpc('ai_usage', { p_org_id: orgId, p_since: since }),
      supabase.rpc('ai_units_left', { p_org_id: orgId, p_daily_units: dailyUnits() }),
    ]);
    if (usage.error) throw usage.error;
    if (left.error) throw left.error;
    return {
      since,
      dailyUnits: dailyUnits(),
      unitsLeftToday: Number(left.data) || 0,
      features: ((usage.data || []) as any[]).map((row) => ({
        feature: String(row.feature),
        calls: Number(row.calls) || 0,
        failed: Number(row.failed) || 0,
        tokensIn: Number(row.tokens_in) || 0,
        tokensOut: Number(row.tokens_out) || 0,
        units: Math.round((Number(row.neurons) || 0) * 10) / 10,
      })),
    };
  }
}
