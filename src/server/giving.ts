import { getSupabase } from './supabase';
import { fetchAllRows } from './pagination';
import { UserError } from './errors';
import {
  candidateMemberNumbers, matchGiving, suggestMembers, type GivingFund, type GivingMatch, type GivingMember, type GivingRule,
} from '../utils/givingRules';

/** A receipt as ingest_mpesa_receipts returns it. */
export interface KeptReceipt {
  id: string;
  trans_id: string;
  trans_time: string;
  amount_cents: number;
  bill_ref_number: string | null;
  first_name: string | null;
  status: 'UNMATCHED' | 'POSTED' | 'IGNORED';
  member_id: string | null;
  fund_id: string | null;
  inserted: boolean;
}

export type MatchSource = 'MPESA_C2B' | 'MPESA_STATEMENT' | 'QUEUE';

export interface MatchToPost {
  receiptId: string;
  memberId: string | null;
  fundId: string;
  incomeAccountId: string | null;
}

export interface AutoPostResult {
  posted: Array<{ receiptId: string; transId: string; contributionId: string; journalEntryId: string; explanation: string }>;
  queued: Array<{ receiptId: string; transId: string; reason: string }>;
}

// Above this many receipts it is cheaper to read the whole register than to
// look members up by the numbers the references could name.
const LOOKUP_LIMIT = 40;

export const NO_INTEGRATION_ACTOR = 'No one is named to post M-Pesa giving. An owner or admin sets this in Settings, Integrations.';

const toRule = (row: any): GivingRule => ({
  id: row.id, priority: Number(row.priority), matchType: row.match_type, pattern: row.pattern,
  fundId: row.fund_id, incomeAccountId: row.income_account_id, isActive: row.is_active !== false,
});
const toFund = (row: any): GivingFund => ({ id: row.id, code: row.code, name: row.name, isActive: row.is_active });
const toMember = (row: any): GivingMember => ({
  id: row.id, memberNumber: row.member_number, firstName: row.first_name, lastName: row.last_name,
});

export class GivingService {
  /** The church's giving rules and funds, as the matching rules read them. */
  static async rulesAndFunds(orgId: string): Promise<{ rules: GivingRule[]; funds: GivingFund[] }> {
    const supabase = getSupabase();
    const [rules, funds] = await Promise.all([
      supabase.from('giving_rules').select('id,priority,match_type,pattern,fund_id,income_account_id,is_active')
        .eq('org_id', orgId).order('priority').limit(500),
      supabase.from('funds').select('id,code,name,is_active').eq('org_id', orgId).order('code').limit(500),
    ]);
    if (rules.error) throw rules.error;
    if (funds.error) throw funds.error;
    return { rules: (rules.data ?? []).map(toRule), funds: (funds.data ?? []).map(toFund) };
  }

  /** Members whose number is one of these, compared without case. */
  static async membersByNumbers(orgId: string, numbers: string[]): Promise<GivingMember[]> {
    const wanted = [...new Set(numbers.filter((value) => /^[A-Za-z0-9-]{1,20}$/.test(value)))];
    if (!wanted.length) return [];
    const supabase = getSupabase();
    const found: GivingMember[] = [];
    for (let i = 0; i < wanted.length; i += 50) {
      const chunk = wanted.slice(i, i + 50);
      const { data, error } = await supabase.from('members').select('id,member_number,first_name,last_name')
        .eq('org_id', orgId).or(chunk.map((value) => `member_number.ilike.${value}`).join(','));
      if (error) throw error;
      found.push(...(data ?? []).map(toMember));
    }
    return found;
  }

  static async allMembers(orgId: string): Promise<GivingMember[]> {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => supabase.from('members')
      .select('id,member_number,first_name,last_name').eq('org_id', orgId).order('id').range(from, to));
    return rows.map(toMember);
  }

  /** Where each waiting receipt goes under the church's rules. */
  static async placeReceipts(orgId: string, receipts: Array<Pick<KeptReceipt, 'id' | 'bill_ref_number' | 'status'>>) {
    const waiting = receipts.filter((receipt) => receipt.status === 'UNMATCHED');
    if (!waiting.length) return [] as Array<{ receiptId: string; match: GivingMatch }>;
    const { rules, funds } = await GivingService.rulesAndFunds(orgId);
    const members = waiting.length > LOOKUP_LIMIT
      ? await GivingService.allMembers(orgId)
      : await GivingService.membersByNumbers(orgId,
        waiting.flatMap((receipt) => candidateMemberNumbers(receipt.bill_ref_number ?? '', rules)));
    return waiting.map((receipt) => ({
      receiptId: receipt.id,
      match: matchGiving(receipt.bill_ref_number, rules, members, funds),
    }));
  }

  /** Posts placed receipts in one database call; each is accepted or refused on its own. */
  static async postMatches(orgId: string, actorId: string, matches: MatchToPost[], source: MatchSource) {
    if (!matches.length) return [] as Array<{ receipt_id: string; contribution_id: string | null; journal_entry_id: string | null; error: string | null }>;
    const { data, error } = await getSupabase().rpc('post_mpesa_matches', {
      p_org_id: orgId, p_matches: matches, p_source: source, p_created_by: actorId,
    });
    if (error) throw error;
    return (data ?? []) as Array<{ receipt_id: string; contribution_id: string | null; journal_entry_id: string | null; error: string | null }>;
  }

  /**
   * Places waiting receipts and posts the ones the rules are sure of, in the
   * name of actorId. The rest stay in the treasurer's queue with the reason.
   * With no one to post in the name of, everything waits in the queue.
   */
  static async autoPost(orgId: string, actorId: string | null, receipts: KeptReceipt[], source: MatchSource): Promise<AutoPostResult> {
    const result: AutoPostResult = { posted: [], queued: [] };
    const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
    const placements = await GivingService.placeReceipts(orgId, receipts);
    const sure: Array<{ match: MatchToPost; explanation: string }> = [];
    for (const { receiptId, match } of placements) {
      const transId = byId.get(receiptId)?.trans_id ?? '';
      if ('reason' in match) { result.queued.push({ receiptId, transId, reason: match.reason }); continue; }
      if (!actorId) { result.queued.push({ receiptId, transId, reason: NO_INTEGRATION_ACTOR }); continue; }
      sure.push({
        match: { receiptId, memberId: match.memberId, fundId: match.fundId, incomeAccountId: match.incomeAccountId },
        explanation: match.explanation,
      });
    }
    if (!actorId || !sure.length) return result;
    const explanations = new Map(sure.map((item) => [item.match.receiptId, item.explanation]));
    const outcomes = await GivingService.postMatches(orgId, actorId, sure.map((item) => item.match), source);
    for (const outcome of outcomes) {
      const transId = byId.get(outcome.receipt_id)?.trans_id ?? '';
      if (outcome.error || !outcome.contribution_id || !outcome.journal_entry_id) {
        result.queued.push({ receiptId: outcome.receipt_id, transId, reason: outcome.error || 'The gift was not posted.' });
      } else {
        result.posted.push({
          receiptId: outcome.receipt_id, transId, contributionId: outcome.contribution_id,
          journalEntryId: outcome.journal_entry_id, explanation: explanations.get(outcome.receipt_id) ?? '',
        });
      }
    }
    return result;
  }

  /**
   * The treasurer's queue: M-Pesa receipts the rules could not place, each
   * with the reason, the fund its reference pointed at and members the
   * treasurer may mean. Receipts set aside are listed after them.
   */
  static async queue(orgId: string) {
    const supabase = getSupabase();
    const [waiting, setAside, context, members] = await Promise.all([
      fetchAllRows<any>((from, to) => supabase.from('mpesa_receipts')
        .select('id,trans_id,trans_time,amount_cents,bill_ref_number,first_name,msisdn,source,status,created_at')
        .eq('org_id', orgId).eq('status', 'UNMATCHED').order('trans_time').order('id').range(from, to)),
      supabase.from('mpesa_receipts').select('id,trans_id,trans_time,amount_cents,bill_ref_number,first_name,ignored_reason')
        .eq('org_id', orgId).eq('status', 'IGNORED').order('trans_time', { ascending: false }).limit(50),
      GivingService.rulesAndFunds(orgId),
      GivingService.allMembers(orgId),
    ]);
    if (setAside.error) throw setAside.error;
    return {
      waiting: waiting.map((receipt) => {
        const match = matchGiving(receipt.bill_ref_number, context.rules, members, context.funds);
        return {
          id: receipt.id, transId: receipt.trans_id, transTime: receipt.trans_time, amountCents: Number(receipt.amount_cents),
          billRefNumber: receipt.bill_ref_number, firstName: receipt.first_name, source: receipt.source,
          reason: 'reason' in match ? match.reason : 'The giving rules place this receipt. Check the member and fund, then post it.',
          suggestedFundId: 'reason' in match ? match.fundId ?? null : match.fundId,
          suggestedMemberId: 'reason' in match ? null : match.memberId,
          suggestions: suggestMembers({ billRefNumber: receipt.bill_ref_number, firstName: receipt.first_name }, members)
            .map(({ member, why }) => ({ memberId: member.id, memberNumber: member.memberNumber, name: [member.firstName, member.lastName].filter(Boolean).join(' '), why })),
        };
      }),
      setAside: (setAside.data ?? []).map((receipt) => ({
        id: receipt.id, transId: receipt.trans_id, transTime: receipt.trans_time, amountCents: Number(receipt.amount_cents),
        billRefNumber: receipt.bill_ref_number, firstName: receipt.first_name, reason: receipt.ignored_reason,
      })),
    };
  }

  /** A person places a waiting receipt: the member (or none) and the fund. */
  static async assign(orgId: string, userId: string, receiptId: string, input: { memberId?: string | null; fundId: string; incomeAccountId?: string | null }) {
    const { data: receipt, error } = await getSupabase().from('mpesa_receipts').select('trans_id,status')
      .eq('org_id', orgId).eq('id', receiptId).maybeSingle();
    if (error) throw error;
    if (!receipt) throw new UserError('M-Pesa receipt not found in this church.', 404);
    if (receipt.status !== 'UNMATCHED') {
      throw new UserError(`M-Pesa receipt ${receipt.trans_id} is ${receipt.status === 'POSTED' ? 'already posted' : 'set aside'}.`, 409);
    }
    const [outcome] = await GivingService.postMatches(orgId, userId,
      [{ receiptId, memberId: input.memberId || null, fundId: input.fundId, incomeAccountId: input.incomeAccountId || null }], 'QUEUE');
    if (!outcome || outcome.error || !outcome.contribution_id) throw new UserError(outcome?.error || 'The gift was not posted.', 409);
    return { contributionId: outcome.contribution_id, journalEntryId: outcome.journal_entry_id };
  }

  static async ignore(orgId: string, userId: string, receiptId: string, reason: string) {
    const { error } = await getSupabase().rpc('ignore_mpesa_receipt', {
      p_org_id: orgId, p_receipt_id: receiptId, p_reason: reason, p_created_by: userId,
    });
    if (error) throw error;
  }

  static async restore(orgId: string, userId: string, receiptId: string) {
    const { error } = await getSupabase().rpc('restore_mpesa_receipt', {
      p_org_id: orgId, p_receipt_id: receiptId, p_created_by: userId,
    });
    if (error) throw error;
  }

  /** A gift handed in or paid to the bank: cash, bank transfer or cheque. M-Pesa gifts come from receipts. */
  static async recordGift(orgId: string, userId: string, input: {
    memberId?: string | null; fundId: string; incomeAccountId?: string | null; amountCents: number;
    method: 'CASH' | 'BANK' | 'CHEQUE'; receivedOn: string; idempotencyKey: string;
  }) {
    const { data, error } = await getSupabase().rpc('record_contribution', {
      p_org_id: orgId, p_member_id: input.memberId || null, p_fund_id: input.fundId,
      p_income_account_id: input.incomeAccountId || null, p_amount_cents: input.amountCents, p_method: input.method,
      p_received_on: input.receivedOn, p_mpesa_receipt_id: null, p_idempotency_key: input.idempotencyKey, p_created_by: userId,
    });
    if (error) throw error;
    return data as { id: string; journalEntryId: string };
  }

  /** Giving received on a day, by fund and by method. */
  static async day(orgId: string, date: string) {
    const supabase = getSupabase();
    const rows = await fetchAllRows<any>((from, to) => supabase.from('contributions')
      .select('id,amount_cents,method,received_on,reference,fund_id,member_id,journal_entry_id,collection_id,mpesa_receipt_id,funds(code,name),members(member_number,first_name,last_name)')
      .eq('org_id', orgId).eq('received_on', date).order('created_at').order('id').range(from, to));
    const byFund = new Map<string, { fundId: string; code: string; name: string; cents: number }>();
    const byMethod: Record<string, number> = {};
    for (const row of rows) {
      const cents = Number(row.amount_cents);
      const fund = byFund.get(row.fund_id) ?? { fundId: row.fund_id, code: row.funds?.code ?? '', name: row.funds?.name ?? '', cents: 0 };
      fund.cents += cents;
      byFund.set(row.fund_id, fund);
      byMethod[row.method] = (byMethod[row.method] || 0) + cents;
    }
    return {
      date,
      totalCents: rows.reduce((sum, row) => sum + Number(row.amount_cents), 0),
      byFund: [...byFund.values()].sort((a, b) => a.code.localeCompare(b.code)),
      byMethod,
      gifts: rows,
    };
  }
}
