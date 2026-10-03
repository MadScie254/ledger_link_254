// Shared by the integration suites: the fixture's ids (tests/db/fixture.sql)
// and a way to read or seed the test database directly.
import { execFileSync } from 'node:child_process';

export const ORG = '00000000-0000-0000-0000-0000000000aa';
export const OWNER = '00000000-0000-0000-0000-000000000001';
export const MEMBER = '00000000-0000-0000-0000-000000000004';
export const BANK = '00000000-0000-0000-0000-00000000a000';
export const AR = '00000000-0000-0000-0000-00000000a110';
export const AP = '00000000-0000-0000-0000-00000000a200';
export const SALES = '00000000-0000-0000-0000-00000000a400';
export const OPEX = '00000000-0000-0000-0000-00000000a600';
export const CUSTOMER = '00000000-0000-0000-0000-0000000000c1';
export const VENDOR = '00000000-0000-0000-0000-0000000000d1';
export const CEMENT = '00000000-0000-0000-0000-0000000000e1'; // Physical Product, 5 on hand
export const DELIVERY = '00000000-0000-0000-0000-0000000000e2'; // Digital Service

const PSQL = process.env.PSQL || 'su postgres -c';

/** Runs one statement against the test database and returns its output. */
export function sql(statement: string): string {
  const [command, ...args] = PSQL.split(' ');
  return execFileSync(command, [...args, `psql -X -q -t -A -d lltest -c "${statement.replace(/"/g, '\\"')}"`]).toString().trim();
}

export const uuid = () => crypto.randomUUID();

/**
 * Asserts the promise is refused with a message matching the pattern. The
 * services rethrow PostgREST errors, which are plain objects, not Errors.
 */
export async function refused(promise: Promise<unknown>, pattern: RegExp) {
  const { default: assert } = await import('node:assert/strict');
  await assert.rejects(promise, (err: any) => {
    assert.match(String(err?.message ?? err), pattern);
    return true;
  });
}
