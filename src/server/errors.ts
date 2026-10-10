/** 502 and 503 are for a service the app depends on (Workers AI) that failed or is not set up. */
export type UserErrorStatus = 400 | 403 | 404 | 409 | 429 | 502 | 503;

/**
 * An error whose message is written for the person using the app: a rule
 * they broke ("Choose the customer"), not an internal failure. The Worker
 * shows these messages as they are; anything else is replaced with a plain
 * sentence (worker/http.ts).
 */
export class UserError extends Error {
  status: UserErrorStatus;
  constructor(message: string, status: UserErrorStatus = 400) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}
