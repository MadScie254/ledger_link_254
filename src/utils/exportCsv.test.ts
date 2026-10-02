import assert from 'node:assert/strict';
import test from 'node:test';
import { toCsv } from './exportCsv.ts';

test('text that a spreadsheet would run as a formula is kept as text', () => {
  assert.equal(
    toCsv([['=HYPERLINK("http://x","Pay")', '+254700000000 x', '@SUM(A1)', '-cmd', 'Acme Ltd']]),
    `"'=HYPERLINK(""http://x"",""Pay"")",'+254700000000 x,'@SUM(A1),'-cmd,Acme Ltd`,
  );
});

test('numbers, including negative amounts written as text, are left alone', () => {
  assert.equal(toCsv([[-1250, '-12.50', '+3', '1,250.00', 0]]), '-1250,-12.50,+3,"1,250.00",0');
});

test('cells with commas, quotes or line breaks are quoted and rows end in CRLF', () => {
  assert.equal(toCsv([['a,b', 'say "hi"', 'two\nlines'], [null, undefined, true]]), '"a,b","say ""hi""","two\nlines"\r\n,,true');
});
