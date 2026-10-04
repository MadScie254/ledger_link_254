import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectCsvLayout,
  guessDateFormat,
  isOfx,
  linesFromCsv,
  linesFromOfx,
  parseCsv,
  parseStatementAmount,
  parseStatementDate,
} from './statementImport.ts';

test('CSV rows keep quoted commas, doubled quotes and line breaks', () => {
  const rows = parseCsv('Date,Details,Amount\r\n15/09/2026,"Payment, ""Acme"" Ltd",1250.00\n16/09/2026,"Two\nlines",-50\n\n');
  assert.deepEqual(rows, [
    ['Date', 'Details', 'Amount'],
    ['15/09/2026', 'Payment, "Acme" Ltd', '1250.00'],
    ['16/09/2026', 'Two\nlines', '-50'],
  ]);
  assert.deepEqual(parseCsv('Date;Amount\n01.09.2026;1.250,50'), [['Date', 'Amount'], ['01.09.2026', '1.250,50']]);
});

test('amounts are read in the forms banks write them', () => {
  assert.equal(parseStatementAmount('1,250.50'), 125050);
  assert.equal(parseStatementAmount('-1250.5'), -125050);
  assert.equal(parseStatementAmount('(1,250.50)'), -125050);
  assert.equal(parseStatementAmount('KES 1,250'), 125000);
  assert.equal(parseStatementAmount('1.250,50'), 125050);
  assert.equal(parseStatementAmount('1250.50 DR'), -125050);
  assert.equal(parseStatementAmount('1250.50 CR'), 125050);
  assert.equal(parseStatementAmount(''), null);
  assert.equal(parseStatementAmount('n/a'), null);
});

test('dates are read day first unless they cannot be', () => {
  assert.equal(parseStatementDate('15/09/2026', 'DMY'), '2026-09-15');
  assert.equal(parseStatementDate('09/15/2026', 'MDY'), '2026-09-15');
  assert.equal(parseStatementDate('2026-09-15 14:02:11', 'DMY'), '2026-09-15');
  assert.equal(parseStatementDate('15-Sep-26', 'DMY'), '2026-09-15');
  assert.equal(parseStatementDate('15 September 2026', 'DMY'), '2026-09-15');
  assert.equal(parseStatementDate('20260915120000[0:GMT]', 'YMD'), '2026-09-15');
  assert.equal(parseStatementDate('31/02/2026', 'DMY'), null);
  assert.equal(guessDateFormat(['01/09/2026', '13/09/2026']), 'DMY');
  assert.equal(guessDateFormat(['09/13/2026']), 'MDY');
  assert.equal(guessDateFormat(['2026-09-13']), 'YMD');
});

test('an M-Pesa statement with paid-in and withdrawn columns becomes signed lines', () => {
  const rows = parseCsv([
    'MPESA STATEMENT',
    'Customer Name:,ACME HARDWARE',
    'Receipt No.,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance',
    'QJK7PL9A2,2026-09-15 14:02:11,Customer Transfer from 0712xxx678 - JANE W,Completed,"1,740.00",,"10,740.00"',
    'QJK7PL9B3,2026-09-16 09:10:00,Pay Bill to 888880 - KPLC,Completed,,-500.00,"10,240.00"',
    'QJK7PL9C4,2026-09-16 09:12:00,Charge,Completed,,,10240.00',
  ].join('\n'));
  const { headerRow, mapping } = detectCsvLayout(rows);
  assert.equal(headerRow, 2);
  assert.ok(mapping);
  assert.equal(mapping!.moneyIn, 4);
  assert.equal(mapping!.moneyOut, 5);
  assert.equal(mapping!.reference, 0);
  const { lines, skipped } = linesFromCsv(rows, headerRow, mapping!);
  assert.deepEqual(lines, [
    { date: '2026-09-15', description: 'Customer Transfer from 0712xxx678 - JANE W', amountCents: 174000, reference: 'QJK7PL9A2' },
    { date: '2026-09-16', description: 'Pay Bill to 888880 - KPLC', amountCents: -50000, reference: 'QJK7PL9B3' },
  ]);
  assert.deepEqual(skipped, [{ row: 6, reason: 'no amount that can be read' }]);
});

test('a bank CSV with one signed amount column', () => {
  const rows = parseCsv('Transaction Date,Narration,Amount,Ref No.\n01/09/2026,SALARY,-120000.00,FT26244\n02/09/2026,DEPOSIT,5000,');
  const { headerRow, mapping } = detectCsvLayout(rows);
  const { lines } = linesFromCsv(rows, headerRow, mapping!);
  assert.deepEqual(lines.map((l) => [l.date, l.amountCents, l.reference]), [['2026-09-01', -12000000, 'FT26244'], ['2026-09-02', 500000, undefined]]);
});

test('OFX transactions are read with their bank ids', () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260915120000[0:GMT]<TRNAMT>1740.00<FITID>2026091501<NAME>JANE W<MEMO>Transfer</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260916<TRNAMT>-500.00<FITID>2026091602<NAME>KPLC &amp; CO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  assert.ok(isOfx(ofx));
  assert.deepEqual(linesFromOfx(ofx), [
    { date: '2026-09-15', description: 'JANE W · Transfer', amountCents: 174000, reference: '2026091501' },
    { date: '2026-09-16', description: 'KPLC & CO', amountCents: -50000, reference: '2026091602' },
  ]);
});
