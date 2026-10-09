/**
 * Seeds "Wanjiru & Otieno Advocates (demo)", a fictional Mizani law firm
 * marked is_demo, owned by an existing Supabase Auth user.
 *
 *   DEMO_USER_ID=<auth user uuid> npm run seed:demo-law
 *
 * Needs SUPABASE_URL and SUPABASE_SECRET_KEY, as the Worker does.
 */
import 'dotenv/config';
import { seedLawDemo, LAW_DEMO_NAME } from './demo/lawDemo';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const userId = process.env.DEMO_USER_ID?.trim() || '';
  if (!UUID_PATTERN.test(userId)) throw new Error('DEMO_USER_ID must be the UUID of an existing Supabase Auth user.');
  const result = await seedLawDemo(userId);
  console.log(`${LAW_DEMO_NAME} seeded: organization ${result.orgId}, ${result.matters} matters.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
