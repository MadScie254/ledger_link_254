import { MembersService } from '../../src/server/members';
import { FundsService } from '../../src/server/funds';
import { GivingService } from '../../src/server/giving';
import { CollectionsService } from '../../src/server/collections';
import { ChurchReportService } from '../../src/server/churchReports';
import { bodyOf, respondError } from '../http';
import { uuid } from '../schemas';
import {
  collectionBankSchema, collectionConfirmSchema, collectionListSchema, collectionStartSchema, contributionSchema,
  dayQuerySchema, fundCreateSchema, fundUpdateSchema, givingRuleSchema, givingRuleUpdateSchema, householdSchema,
  memberCreateSchema, memberImportSchema, memberListSchema, memberUpdateSchema, monthQuerySchema, periodQuerySchema,
  queueAssignSchema, queueIgnoreSchema,
} from '../churchSchemas';
import { requireChurchEdition } from './mpesa';
import type { Api } from './types';

// The project compiles without strictNullChecks, so Zod's parsed types come
// out all-optional; the schema has already enforced what the service needs.
type Input<F extends (...args: any[]) => any, N extends number> = Parameters<F>[N];

/** Kundi: members, funds, giving, cash counts and the treasurer's reports. 403 outside church organizations. */
export function registerChurchRoutes(api: Api) {
  for (const path of ['/members', '/members/*', '/households', '/funds', '/funds/*', '/giving-rules', '/giving-rules/*',
    '/giving/*', '/contributions', '/collections', '/collections/*', '/church-reports/*', '/church/*']) {
    api.use(path, requireChurchEdition);
  }

  // --- Members and households ---
  api.get('/members', async (c) => {
    try {
      const filters = memberListSchema.parse(c.req.query());
      return c.json({ members: await MembersService.list(c.get('orgId'), filters as Input<typeof MembersService.list, 1>) });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/members', async (c) => {
    try {
      const body = memberCreateSchema.parse(await bodyOf(c));
      return c.json({ id: await MembersService.create(c.get('orgId'), c.get('userId'), body as Input<typeof MembersService.create, 2>) }, 201);
    } catch (err) { return respondError(c, err); }
  });
  api.post('/members/import', async (c) => {
    try {
      const body = memberImportSchema.parse(await bodyOf(c));
      return c.json(await MembersService.importMany(c.get('orgId'), c.get('userId'), body.members as Input<typeof MembersService.importMany, 2>), 201);
    } catch (err) { return respondError(c, err); }
  });
  api.get('/members/:id', async (c) => {
    try { return c.json(await MembersService.get(c.get('orgId'), uuid.parse(c.req.param('id')))); }
    catch (err) { return respondError(c, err); }
  });
  api.patch('/members/:id', async (c) => {
    try {
      const body = memberUpdateSchema.parse(await bodyOf(c));
      await MembersService.update(c.get('orgId'), uuid.parse(c.req.param('id')), body as Input<typeof MembersService.update, 2>);
      return c.json({ ok: true });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/households', async (c) => {
    try { return c.json({ households: await MembersService.households(c.get('orgId')) }); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/households', async (c) => {
    try {
      const body = householdSchema.parse(await bodyOf(c));
      return c.json({ id: await MembersService.createHousehold(c.get('orgId'), c.get('userId'), body as Input<typeof MembersService.createHousehold, 2>) }, 201);
    } catch (err) { return respondError(c, err); }
  });

  // --- Funds and giving rules ---
  api.get('/funds', async (c) => {
    try { return c.json({ funds: await FundsService.list(c.get('orgId')) }); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/funds', async (c) => {
    try {
      const body = fundCreateSchema.parse(await bodyOf(c));
      return c.json({ id: await FundsService.create(c.get('orgId'), body as Input<typeof FundsService.create, 1>) }, 201);
    } catch (err) { return respondError(c, err); }
  });
  api.patch('/funds/:id', async (c) => {
    try {
      const body = fundUpdateSchema.parse(await bodyOf(c));
      await FundsService.update(c.get('orgId'), uuid.parse(c.req.param('id')), body);
      return c.json({ ok: true });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/giving-rules', async (c) => {
    try { return c.json({ rules: await FundsService.rules(c.get('orgId')) }); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/giving-rules', async (c) => {
    try {
      const body = givingRuleSchema.parse(await bodyOf(c));
      return c.json({ id: await FundsService.createRule(c.get('orgId'), body as Input<typeof FundsService.createRule, 1>) }, 201);
    } catch (err) { return respondError(c, err); }
  });
  api.patch('/giving-rules/:id', async (c) => {
    try {
      const body = givingRuleUpdateSchema.parse(await bodyOf(c));
      await FundsService.updateRule(c.get('orgId'), uuid.parse(c.req.param('id')), body);
      return c.json({ ok: true });
    } catch (err) { return respondError(c, err); }
  });

  // --- Giving ---
  api.get('/giving/queue', async (c) => {
    try { return c.json(await GivingService.queue(c.get('orgId'))); }
    catch (err) { return respondError(c, err); }
  });
  api.post('/giving/queue/:receiptId/assign', async (c) => {
    try {
      const body = queueAssignSchema.parse(await bodyOf(c));
      return c.json(await GivingService.assign(c.get('orgId'), c.get('userId'), uuid.parse(c.req.param('receiptId')),
        body as Input<typeof GivingService.assign, 3>));
    } catch (err) { return respondError(c, err); }
  });
  api.post('/giving/queue/:receiptId/ignore', async (c) => {
    try {
      const body = queueIgnoreSchema.parse(await bodyOf(c));
      await GivingService.ignore(c.get('orgId'), c.get('userId'), uuid.parse(c.req.param('receiptId')), body.reason as string);
      return c.json({ ok: true });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/giving/queue/:receiptId/restore', async (c) => {
    try {
      await GivingService.restore(c.get('orgId'), c.get('userId'), uuid.parse(c.req.param('receiptId')));
      return c.json({ ok: true });
    } catch (err) { return respondError(c, err); }
  });
  api.get('/giving/day', async (c) => {
    try {
      const { date } = dayQuerySchema.parse(c.req.query());
      return c.json(await GivingService.day(c.get('orgId'), date as string));
    } catch (err) { return respondError(c, err); }
  });
  api.post('/contributions', async (c) => {
    try {
      const body = contributionSchema.parse(await bodyOf(c));
      return c.json(await GivingService.recordGift(c.get('orgId'), c.get('userId'), body as Input<typeof GivingService.recordGift, 2>), 201);
    } catch (err) { return respondError(c, err); }
  });

  // --- Cash counts ---
  api.get('/collections', async (c) => {
    try {
      const filters = collectionListSchema.parse(c.req.query());
      return c.json({ collections: await CollectionsService.list(c.get('orgId'), filters) });
    } catch (err) { return respondError(c, err); }
  });
  api.post('/collections', async (c) => {
    try {
      const body = collectionStartSchema.parse(await bodyOf(c));
      return c.json(await CollectionsService.start(c.get('orgId'), c.get('userId'), body as Input<typeof CollectionsService.start, 2>), 201);
    } catch (err) { return respondError(c, err); }
  });
  api.post('/collections/:id/confirm', async (c) => {
    try {
      const body = collectionConfirmSchema.parse(await bodyOf(c));
      return c.json(await CollectionsService.confirm(c.get('orgId'), c.get('userId'), uuid.parse(c.req.param('id')),
        body as Input<typeof CollectionsService.confirm, 3>));
    } catch (err) { return respondError(c, err); }
  });
  api.post('/collections/:id/bank', async (c) => {
    try {
      const body = collectionBankSchema.parse(await bodyOf(c));
      return c.json(await CollectionsService.bank(c.get('orgId'), c.get('userId'), uuid.parse(c.req.param('id')),
        body as Input<typeof CollectionsService.bank, 3>));
    } catch (err) { return respondError(c, err); }
  });

  // --- Reports and Home ---
  api.get('/church-reports/treasurer', async (c) => {
    try {
      const { month } = monthQuerySchema.parse(c.req.query());
      return c.json(await ChurchReportService.treasurer(c.get('orgId'), month as string));
    } catch (err) { return respondError(c, err); }
  });
  api.get('/church-reports/fund-balances', async (c) => {
    try {
      const { from, to } = periodQuerySchema.parse(c.req.query());
      return c.json(await ChurchReportService.fundBalances(c.get('orgId'), from as string, to as string));
    } catch (err) { return respondError(c, err); }
  });
  api.get('/church/dashboard', async (c) => {
    try { return c.json(await ChurchReportService.dashboard(c.get('orgId'))); }
    catch (err) { return respondError(c, err); }
  });
}
