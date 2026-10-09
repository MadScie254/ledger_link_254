/**
 * Reading a church's member register from CSV (rows from PapaParse) into
 * member records, with a reason for every row that cannot be taken. A phone
 * number or email needs the member's consent (Data Protection Act), so a
 * row with either and no consent is refused rather than saved without it.
 */
import { guessDateFormat, parseStatementDate, type DateFormat } from './statementImport.ts';

export type MemberStatus = 'VISITOR' | 'ADHERENT' | 'MEMBER' | 'BAPTISED_MEMBER' | 'TRANSFERRED' | 'DECEASED' | 'INACTIVE';
export const MEMBER_STATUSES: MemberStatus[] = ['VISITOR', 'ADHERENT', 'MEMBER', 'BAPTISED_MEMBER', 'TRANSFERRED', 'DECEASED', 'INACTIVE'];

export type MemberField =
  | 'memberNumber' | 'firstName' | 'lastName' | 'phone' | 'email' | 'status' | 'household'
  | 'dateOfBirth' | 'joinedOn' | 'consentMethod' | 'notes';

export type MemberMapping = Partial<Record<MemberField, number>> & { dateFormat?: DateFormat };

export const MEMBER_FIELDS: Array<{ field: MemberField; label: string; required: boolean }> = [
  { field: 'memberNumber', label: 'Member number', required: true },
  { field: 'firstName', label: 'First name', required: true },
  { field: 'lastName', label: 'Last name', required: false },
  { field: 'phone', label: 'Phone', required: false },
  { field: 'email', label: 'Email', required: false },
  { field: 'consentMethod', label: 'Consent to contact (how it was given)', required: false },
  { field: 'status', label: 'Status', required: false },
  { field: 'household', label: 'Household', required: false },
  { field: 'dateOfBirth', label: 'Date of birth', required: false },
  { field: 'joinedOn', label: 'Joined on', required: false },
  { field: 'notes', label: 'Notes', required: false },
];

const HINTS: Record<MemberField, RegExp> = {
  memberNumber: /^(member( no\.?| number| #)?|no\.?|number|member ?id|ref(erence)?)$/i,
  firstName: /^(first ?name|given names?|first|name)$/i,
  lastName: /^(last ?name|surname|family name|other names?)$/i,
  phone: /^(phone( number)?|mobile|tel(ephone)?|cell)$/i,
  email: /^(e-?mail( address)?)$/i,
  status: /^(status|membership( status)?|category)$/i,
  household: /^(household|family|home)$/i,
  dateOfBirth: /^(date of birth|dob|birth ?date|born)$/i,
  joinedOn: /^(joined( on)?|date joined|member since|joined date)$/i,
  consentMethod: /^(consent( method)?|consent given|contact consent)$/i,
  notes: /^(notes?|comments?|remarks?)$/i,
};

/** Guesses each column from the header row (the first row of the file). */
export function detectMemberColumns(header: string[]): MemberMapping {
  const mapping: MemberMapping = {};
  const taken = new Set<number>();
  for (const { field } of MEMBER_FIELDS) {
    const index = header.findIndex((cell, i) => !taken.has(i) && HINTS[field].test(String(cell ?? '').trim()));
    if (index !== -1) { mapping[field] = index; taken.add(index); }
  }
  return mapping;
}

export function missingMemberFields(mapping: MemberMapping): string[] {
  return MEMBER_FIELDS.filter(({ field, required }) => required && mapping[field] === undefined).map(({ label }) => label);
}

const STATUS_WORDS: Record<string, MemberStatus> = {
  VISITOR: 'VISITOR', ADHERENT: 'ADHERENT', MEMBER: 'MEMBER', 'FULL MEMBER': 'MEMBER',
  BAPTISED: 'BAPTISED_MEMBER', BAPTIZED: 'BAPTISED_MEMBER', 'BAPTISED MEMBER': 'BAPTISED_MEMBER',
  'BAPTIZED MEMBER': 'BAPTISED_MEMBER', BAPTISED_MEMBER: 'BAPTISED_MEMBER',
  TRANSFERRED: 'TRANSFERRED', 'TRANSFERRED OUT': 'TRANSFERRED', DECEASED: 'DECEASED', INACTIVE: 'INACTIVE',
};

/** "Baptised member", "baptized" and "BAPTISED_MEMBER" are one status; blank is MEMBER. */
export function readMemberStatus(value: string | null | undefined): MemberStatus | null {
  const text = String(value ?? '').trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
  if (!text) return 'MEMBER';
  return STATUS_WORDS[text] ?? STATUS_WORDS[text.replace(/ /g, '_')] ?? null;
}

/** Member numbers are kept upper case: they are also the M-Pesa account reference. */
export function normaliseMemberNumber(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9-]{1,20}$/.test(text) ? text : null;
}

export interface ImportedMember {
  memberNumber: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  status: MemberStatus;
  household: string | null;
  dateOfBirth: string | null;
  joinedOn: string | null;
  consentMethod: string | null;
  notes: string | null;
}

export interface MemberImportRead {
  members: ImportedMember[];
  problems: Array<{ row: number; reason: string }>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The members in the rows below the header. existingNumbers are the
 * numbers already in the register (upper case), which a row may not reuse.
 */
export function readMembers(rows: string[][], mapping: MemberMapping, existingNumbers: Set<string> = new Set()): MemberImportRead {
  const cell = (row: string[], field: MemberField) =>
    mapping[field] === undefined ? '' : String(row[mapping[field] as number] ?? '').trim();
  const dateSamples = rows.slice(1, 41).flatMap((row) => [cell(row, 'dateOfBirth'), cell(row, 'joinedOn')]).filter(Boolean);
  const format = mapping.dateFormat ?? guessDateFormat(dateSamples);
  const members: ImportedMember[] = [];
  const problems: Array<{ row: number; reason: string }> = [];
  const seen = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    if (!row || row.every((value) => !String(value ?? '').trim())) continue;
    const rawNumber = cell(row, 'memberNumber');
    const memberNumber = normaliseMemberNumber(rawNumber);
    if (!memberNumber) {
      problems.push({ row: line, reason: rawNumber ? `member number ${rawNumber} is not 1 to 20 letters, digits or hyphens` : 'no member number' });
      continue;
    }
    if (seen.has(memberNumber)) { problems.push({ row: line, reason: `member number ${memberNumber} appears twice in the file` }); continue; }
    if (existingNumbers.has(memberNumber)) { problems.push({ row: line, reason: `member number ${memberNumber} is already in the register` }); continue; }
    const firstName = cell(row, 'firstName');
    if (!firstName) { problems.push({ row: line, reason: 'no first name' }); continue; }
    if (firstName.length > 100) { problems.push({ row: line, reason: 'the first name is longer than 100 characters' }); continue; }
    const status = readMemberStatus(cell(row, 'status'));
    if (!status) { problems.push({ row: line, reason: `status ${cell(row, 'status')} is not one Kundi keeps` }); continue; }
    const phone = cell(row, 'phone').slice(0, 40) || null;
    const email = cell(row, 'email').toLowerCase().slice(0, 320) || null;
    if (email && !EMAIL.test(email)) { problems.push({ row: line, reason: `email ${email} is not an email address` }); continue; }
    const consentMethod = cell(row, 'consentMethod').slice(0, 100) || null;
    if ((phone || email) && !consentMethod) {
      problems.push({ row: line, reason: 'a phone number or email needs the member\'s consent: say how it was given (for example "Signed form")' });
      continue;
    }
    const dateOf = (field: MemberField, label: string) => {
      const text = cell(row, field);
      if (!text) return { value: null as string | null };
      const value = parseStatementDate(text, format);
      return value ? { value } : { problem: `${label} ${text} is not a date that can be read` };
    };
    const born = dateOf('dateOfBirth', 'date of birth');
    if ('problem' in born) { problems.push({ row: line, reason: born.problem }); continue; }
    const joined = dateOf('joinedOn', 'joined on');
    if ('problem' in joined) { problems.push({ row: line, reason: joined.problem }); continue; }
    seen.add(memberNumber);
    members.push({
      memberNumber,
      firstName,
      lastName: cell(row, 'lastName').slice(0, 100) || null,
      phone,
      email,
      status,
      household: cell(row, 'household').slice(0, 200) || null,
      dateOfBirth: born.value,
      joinedOn: joined.value,
      consentMethod: phone || email ? consentMethod : null,
      notes: cell(row, 'notes').slice(0, 2000) || null,
    });
  }
  return { members, problems };
}
