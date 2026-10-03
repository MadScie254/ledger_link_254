import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who a Worker request acts for. Every service-role query made while the
 * request runs sends the actor in the x-ledger-actor header, which the audit
 * triggers record (private.request_actor), so a change to a customer, an
 * employee or a stock item is attributed to the signed-in person who made it.
 */
export interface RequestContext {
  actorId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentActorId(): string | undefined {
  return storage.getStore()?.actorId;
}
