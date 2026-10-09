/**
 * Placing an M-Pesa gift: which member gave it and which fund it is for,
 * read from the account reference the giver typed (BillRefNumber). The
 * church's giving rules are tried in priority order and the first rule that
 * fits decides. A gift is posted on its own only when the rule leaves no
 * doubt; anything else waits in the treasurer's queue with a reason.
 *
 * The payer's phone number is never used: Safaricom sends it masked.
 */

export type GivingMatchType = 'MEMBER_NUMBER' | 'PREFIX' | 'EXACT';

export interface GivingRule {
  id: string;
  priority: number;
  matchType: GivingMatchType;
  /** The text matched for EXACT and PREFIX; ignored for MEMBER_NUMBER. */
  pattern: string | null;
  fundId: string;
  /** Credits this income account instead of the fund's own (TITHE → 4010). */
  incomeAccountId: string | null;
  isActive?: boolean;
}

export interface GivingMember {
  id: string;
  memberNumber: string;
  firstName?: string | null;
  lastName?: string | null;
}

export interface GivingFund {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export type GivingMatch =
  | {
      matched: true;
      memberId: string | null;
      fundId: string;
      incomeAccountId: string | null;
      ruleId: string;
      explanation: string;
    }
  | {
      matched: false;
      reason: string;
      /** The fund the reference pointed at, when it got that far. */
      fundId?: string;
      ruleId?: string;
    };

/** Upper case, no spaces, no leading '#': " bld 1043" and "#BLD1043" read the same. */
export function compactReference(reference: string | null | undefined): string {
  return (reference ?? '').toUpperCase().replace(/\s+/g, '').replace(/^#+/, '');
}

/** The key member numbers are compared on (the database keeps them unique on upper case). */
export function memberNumberKey(memberNumber: string): string {
  return memberNumber.trim().toUpperCase();
}

const SEPARATORS = /^[-#:/._]+/;

/** What follows the prefix, without separators, or null when the reference does not start with it. */
export function afterPrefix(reference: string, prefix: string): string | null {
  const compact = compactReference(reference);
  const head = compactReference(prefix);
  if (!head || !compact.startsWith(head)) return null;
  return compact.slice(head.length).replace(SEPARATORS, '');
}

export function sortRules(rules: GivingRule[]): GivingRule[] {
  return rules
    .filter((rule) => rule.isActive !== false)
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/**
 * The member numbers a reference could name under these rules: the whole
 * reference, and what follows each prefix. Used to look members up without
 * reading the whole register.
 */
export function candidateMemberNumbers(reference: string, rules: GivingRule[]): string[] {
  const compact = compactReference(reference);
  if (!compact) return [];
  const found = new Set<string>([compact]);
  for (const rule of rules) {
    if (rule.matchType !== 'PREFIX' || !rule.pattern) continue;
    const rest = afterPrefix(compact, rule.pattern);
    if (rest) found.add(rest);
  }
  return [...found].filter((value) => /^[A-Z0-9-]{1,20}$/.test(value));
}

function memberIndex(members: GivingMember[] | Map<string, GivingMember>): Map<string, GivingMember> {
  if (members instanceof Map) return members;
  return new Map(members.map((member) => [memberNumberKey(member.memberNumber), member]));
}

/**
 * The fund and member a reference names. The first rule that fits decides:
 * - EXACT: the whole reference is the pattern ("TITHE"); no member.
 * - PREFIX: the reference starts with the pattern ("BLD", "BLD-1043"); what
 *   follows, if anything, must be a member number.
 * - MEMBER_NUMBER: the whole reference is a member number ("1043").
 */
export function matchGiving(
  reference: string | null | undefined,
  rules: GivingRule[],
  members: GivingMember[] | Map<string, GivingMember>,
  funds: GivingFund[],
): GivingMatch {
  const compact = compactReference(reference);
  if (!compact) return { matched: false, reason: 'The giver left the account reference blank.' };
  const byNumber = memberIndex(members);
  const fundById = new Map(funds.map((fund) => [fund.id, fund]));

  const place = (rule: GivingRule, member: GivingMember | null, how: string): GivingMatch => {
    const fund = fundById.get(rule.fundId);
    if (!fund) return { matched: false, reason: `The rule for "${how}" names a fund this church does not have.`, ruleId: rule.id };
    if (!fund.isActive) {
      return { matched: false, reason: `The ${fund.name} is closed to new giving.`, fundId: fund.id, ruleId: rule.id };
    }
    return {
      matched: true,
      memberId: member?.id ?? null,
      fundId: fund.id,
      incomeAccountId: rule.incomeAccountId,
      ruleId: rule.id,
      explanation: member
        ? `Reference ${compact}: member ${member.memberNumber}, ${fund.name}.`
        : `Reference ${compact}: ${fund.name}, no member named.`,
    };
  };

  for (const rule of sortRules(rules)) {
    if (rule.matchType === 'EXACT') {
      if (rule.pattern && compact === compactReference(rule.pattern)) return place(rule, null, rule.pattern);
    } else if (rule.matchType === 'PREFIX') {
      if (!rule.pattern) continue;
      const rest = afterPrefix(compact, rule.pattern);
      if (rest === null) continue;
      if (rest === '') return place(rule, null, rule.pattern);
      const member = byNumber.get(rest);
      if (member) return place(rule, member, rule.pattern);
      const fund = fundById.get(rule.fundId);
      return {
        matched: false,
        reason: `Reference ${compact} starts with ${compactReference(rule.pattern)}${fund ? ` (${fund.name})` : ''}, but ${rest} is not a member number.`,
        fundId: rule.fundId,
        ruleId: rule.id,
      };
    } else if (rule.matchType === 'MEMBER_NUMBER') {
      const member = byNumber.get(compact);
      if (member) return place(rule, member, 'member number');
    }
  }
  return { matched: false, reason: `No giving rule fits reference ${compact}.` };
}

export interface MemberSuggestion {
  member: GivingMember;
  why: string;
}

/**
 * Members the treasurer may mean for a gift the rules could not place:
 * a member number inside the reference, or the payer's first name. These
 * are suggestions only; nothing posts until a person picks one.
 */
export function suggestMembers(
  receipt: { billRefNumber?: string | null; firstName?: string | null },
  members: GivingMember[],
  limit = 3,
): MemberSuggestion[] {
  const compact = compactReference(receipt.billRefNumber);
  const digitRuns = new Set(compact.match(/\d{2,}/g) ?? []);
  const payer = (receipt.firstName ?? '').trim().toUpperCase();
  const scored: Array<{ member: GivingMember; why: string; score: number }> = [];
  for (const member of members) {
    const number = memberNumberKey(member.memberNumber);
    if (digitRuns.has(number)) {
      scored.push({ member, why: `Member number ${member.memberNumber} is in the reference.`, score: 3 });
    } else if (number.length >= 3 && compact.includes(number)) {
      scored.push({ member, why: `The reference contains ${member.memberNumber}.`, score: 2 });
    } else if (payer && (member.firstName ?? '').trim().toUpperCase() === payer) {
      scored.push({ member, why: `The payer's first name is ${receipt.firstName?.trim()}.`, score: 1 });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score || a.member.memberNumber.localeCompare(b.member.memberNumber))
    .slice(0, limit)
    .map(({ member, why }) => ({ member, why }));
}
