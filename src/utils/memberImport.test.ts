import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectMemberColumns, missingMemberFields, normaliseMemberNumber, readMemberStatus, readMembers } from './memberImport.ts';

// Made-up names; no real people.
const rows = [
  ['Member No', 'First name', 'Surname', 'Phone', 'Email', 'Consent', 'Status', 'Household', 'DOB', 'Joined'],
  ['1043', 'Mfano', 'Mmoja', '0700000043', '', 'Signed form', 'Baptised member', 'Nyumba ya Mfano', '14/02/1990', '01/03/2015'],
  ['k-77', 'Jina', '', '', '', '', '', '', '', ''],
  ['1043', 'Rudia', '', '', '', '', '', '', '', ''],
  ['', 'Hana nambari', '', '', '', '', '', '', '', ''],
  ['2001', '', '', '', '', '', '', '', '', ''],
  ['2002', 'Simu', '', '0700000002', '', '', 'member', '', '', ''],
  ['2003', 'Barua', '', '', 'not-an-email', 'Verbal', '', '', '', ''],
  ['2004', 'Hali', '', '', '', '', 'Elder', '', '', ''],
  ['2005', 'Tarehe', '', '', '', '', '', '', '31/02/1990', ''],
  ['1000', 'Tayari', '', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', '', '', ''],
  ['2006', 'Mwisho', 'Mfano', '', 'MWISHO@EXAMPLE.ORG', 'Online form', 'visitor', 'Nyumba ya Mfano', '', '2026-01-04'],
];

test('member columns are found from common header names', () => {
  const mapping = detectMemberColumns(rows[0]);
  assert.deepEqual(mapping, {
    memberNumber: 0, firstName: 1, lastName: 2, phone: 3, email: 4, consentMethod: 5, status: 6, household: 7, dateOfBirth: 8, joinedOn: 9,
  });
  assert.deepEqual(missingMemberFields(mapping), []);
  assert.deepEqual(missingMemberFields({ firstName: 0 }), ['Member number']);
});

test('members are read with consent, statuses and dates, and every refused row says why', () => {
  const read = readMembers(rows, detectMemberColumns(rows[0]), new Set(['1000']));
  assert.deepEqual(read.members.map((m) => m.memberNumber), ['1043', 'K-77', '2006']);
  assert.deepEqual(read.members[0], {
    memberNumber: '1043', firstName: 'Mfano', lastName: 'Mmoja', phone: '0700000043', email: null, status: 'BAPTISED_MEMBER',
    household: 'Nyumba ya Mfano', dateOfBirth: '1990-02-14', joinedOn: '2015-03-01', consentMethod: 'Signed form', notes: null,
  });
  assert.equal(read.members[1].status, 'MEMBER', 'a blank status is a member');
  assert.equal(read.members[2].email, 'mwisho@example.org');
  assert.deepEqual(read.problems, [
    { row: 4, reason: 'member number 1043 appears twice in the file' },
    { row: 5, reason: 'no member number' },
    { row: 6, reason: 'no first name' },
    { row: 7, reason: 'a phone number or email needs the member\'s consent: say how it was given (for example "Signed form")' },
    { row: 8, reason: 'email not-an-email is not an email address' },
    { row: 9, reason: 'status Elder is not one Kundi keeps' },
    { row: 10, reason: 'date of birth 31/02/1990 is not a date that can be read' },
    { row: 11, reason: 'member number 1000 is already in the register' },
  ]);
});

test('statuses and member numbers are read the same however they are typed', () => {
  assert.equal(readMemberStatus('baptized'), 'BAPTISED_MEMBER');
  assert.equal(readMemberStatus('BAPTISED_MEMBER'), 'BAPTISED_MEMBER');
  assert.equal(readMemberStatus('Transferred out'), 'TRANSFERRED');
  assert.equal(readMemberStatus(''), 'MEMBER');
  assert.equal(readMemberStatus('elder'), null);
  assert.equal(normaliseMemberNumber(' bld-12 '), 'BLD-12');
  assert.equal(normaliseMemberNumber('12 34'), null);
  assert.equal(normaliseMemberNumber('x'.repeat(21)), null);
});
