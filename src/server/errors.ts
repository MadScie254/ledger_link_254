/**
 * An error whose message is written for the person using the app: a rule
 * they broke ("Choose the customer"), not an internal failure. The Worker
 * shows these messages as they are; anything else is replaced with a plain
 * sentence (worker/http.ts).
 */
export class UserError extends Error {
  status: 400 | 403 | 404 | 409 | 429;
  constructor(message: string, status: 400 | 403 | 404 | 409 | 429 = 400) {
    super(message);
    this.name = 'UserError';
    this.status = status;
  }
}
