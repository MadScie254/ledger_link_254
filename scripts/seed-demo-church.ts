/**
 * Seeds "Kanisa la Mfano (demo)", a fictional Kundi church marked is_demo,
 * owned by an existing Supabase Auth user. With DEMO_SECOND_USER_ID (another
 * existing user, added as accountant) Sunday cash is counted by two people.
 *
 *   DEMO_USER_ID=<auth user uuid> [DEMO_SECOND_USER_ID=<uuid>] npm run seed:demo-church
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY, as the Worker does.
 */
import 'dotenv/config';
import { seedChurchDemo, CHURCH_DEMO_NAME } from './demo/churchDemo';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const userId = process.env.DEMO_USER_ID?.trim() || '';
  if (!UUID_PATTERN.test(userId)) throw new Error('DEMO_USER_ID must be the UUID of an existing Supabase Auth user.');
  const secondUserId = process.env.DEMO_SECOND_USER_ID?.trim() || undefined;
  if (secondUserId && (!UUID_PATTERN.test(secondUserId) || secondUserId === userId)) {
    throw new Error('DEMO_SECOND_USER_ID must be the UUID of a different existing Supabase Auth user.');
  }
  const result = await seedChurchDemo(userId, { secondUserId });
  console.log(`${CHURCH_DEMO_NAME} seeded: organization ${result.orgId}, ${result.members} members, ${result.sundays} Sundays, `
    + `${result.mpesaPosted} M-Pesa gifts posted and ${result.mpesaQueued} waiting in the queue.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
