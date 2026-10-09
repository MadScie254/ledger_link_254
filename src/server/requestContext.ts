import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who a Worker request acts for. Every service-role query made while the
 * request runs sends the actor in the x-ledger-actor header, which the audit
 * triggers record (private.request_actor), so a change to a customer, an
 * employee or a stock item is attributed to the signed-in person who made it.
 */
export interface RequestContext {
  actorId?: string;
  /** The class and location a posting request is made under, checked by the database. */
  classId?: string;
  locationId?: string;
  /** The church fund an expense is posted to (Kundi), checked by the database. */
  fundId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentActorId(): string | undefined {
  return storage.getStore()?.actorId;
}

/** Headers naming who acts and the class, location and fund postings are made under. */
export function contextHeaders(): Record<string, string> {
  const context = storage.getStore();
  const headers: Record<string, string> = {};
  if (context?.actorId) headers['x-ledger-actor'] = context.actorId;
  if (context?.classId) headers['x-ledger-class'] = context.classId;
  if (context?.locationId) headers['x-ledger-location'] = context.locationId;
  if (context?.fundId) headers['x-ledger-fund'] = context.fundId;
  return headers;
}
