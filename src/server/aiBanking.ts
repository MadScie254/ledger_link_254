import { getSupabase } from './supabase';
import { WorkersAiService, type AiCaller } from './workersAi';
import { AccountService } from './accounts';
import { AI_MODELS } from '../utils/workersAi';
import {
  BANK_LINES_PER_REQUEST, BANK_SYSTEM_PROMPT, bankSuggestionInput, parseBankSuggestions, postableForAi,
  type BankLineForAi, type BankSuggestion,
} from '../utils/aiBank';

/**
 * Suggests an account for statement lines that are not matched and have no
 * suggestion yet. The suggestion is stored on the line (ai_category_code and
 * ai_category_name), where the matching dialog offers it; nothing is posted.
 * A line is sent once: one the model cannot place is marked with an empty
 * code.
 * The automatic acceptance of strong matches never reads these columns.
 */
export class BankSuggestionService {
  static async suggest(caller: AiCaller): Promise<{ suggestions: BankSuggestion[]; considered: number; remaining: number }> {
    const ai = await WorkersAiService.assertAvailable(caller);
    const supabase = getSupabase();
    const [{ data: rows, error }, { count, error: countError }, accounts, { data: org, error: orgError }] = await Promise.all([
      supabase.from('bank_transactions')
        .select('id, date, description, amount_cents, direction')
        .eq('org_id', caller.orgId).neq('status', 'MATCHED').is('ai_category_code', null)
        .order('date', { ascending: false }).order('id')
        .limit(BANK_LINES_PER_REQUEST),
      supabase.from('bank_transactions').select('id', { count: 'exact', head: true })
        .eq('org_id', caller.orgId).neq('status', 'MATCHED').is('ai_category_code', null),
      AccountService.getAccounts(caller.orgId),
      supabase.from('organizations').select('base_currency').eq('id', caller.orgId).maybeSingle(),
    ]);
    if (error) throw error;
    if (countError) throw countError;
    if (orgError) throw orgError;

    const lines: BankLineForAi[] = (rows || []).map((row: any) => ({
      id: row.id, date: String(row.date), description: row.description, amountCents: Number(row.amount_cents) || 0, direction: row.direction,
    }));
    if (lines.length === 0) return { suggestions: [], considered: 0, remaining: 0 };
    const chart = postableForAi(accounts.map((a) => ({ id: a.id, code: String(a.code), name: String(a.name), type: String(a.type), isActive: a.isActive, isBankAccount: a.isBankAccount })));

    const reply = await WorkersAiService.run(caller, ai, {
      feature: 'bank.suggest',
      model: AI_MODELS.text,
      input: {
        messages: [{ role: 'system', content: BANK_SYSTEM_PROMPT }, { role: 'user', content: bankSuggestionInput(lines, chart, org?.base_currency || 'KES') }],
        max_tokens: 1400,
        temperature: 0,
      },
    });
    const suggestions = parseBankSuggestions(reply.json, lines, chart);

    // Stored one line at a time, and only while the line is still unmatched.
    // A line the model could not place is marked with an empty code, which
    // the matching dialog treats as no suggestion, so it is not sent again.
    const byLine = new Map(suggestions.map((s) => [s.transactionId, s]));
    await Promise.all(lines.map(async (line) => {
      const found = byLine.get(line.id);
      const { error: updateError } = await supabase.from('bank_transactions')
        .update({ ai_category_code: found?.code ?? '', ai_category_name: found?.name ?? null })
        .eq('org_id', caller.orgId).eq('id', line.id).neq('status', 'MATCHED');
      if (updateError) throw updateError;
    }));

    return { suggestions, considered: lines.length, remaining: Math.max(0, (count ?? lines.length) - lines.length) };
  }
}
