import { z } from 'zod';
import { UserError } from './errors';

// Postgres's own wording for constraint failures names tables, columns and
// constraints. Those are replaced with a plain sentence for the SQLSTATE;
// messages the app's own functions RAISE are sentences already and pass
// through.
const RAW_DATABASE_MESSAGE = /violates|constraint|column|relation|syntax|invalid input|permission denied|null value|out of range|overflow|does not exist|duplicate key/i;
const DATABASE_MESSAGES: Record<string, string> = {
  '23505': 'That record already exists.',
  '23503': 'A linked record does not exist, belongs to another organization, or is still in use.',
  '23514': 'A value is outside what is allowed.',
  '23502': 'A required value is missing.',
  '22P02': 'A value is in the wrong format.',
  '22001': 'A value is too long.',
  '22003': 'A number is too large.',
  '22007': 'A date is in the wrong format.',
  '22008': 'A date is out of range.',
  '42501': 'Your role does not allow this.',
};
const STATUS_BY_SQLSTATE: Record<string, 400 | 403 | 404 | 409> = {
  '42501': 403,
  '23505': 409,
};

function errorCode(err: unknown): string {
  return err && typeof err === 'object' && typeof (err as any).code === 'string' ? (err as any).code : '';
}

function errorMessage(err: unknown): string {
  return err && typeof err === 'object' && typeof (err as any).message === 'string' ? (err as any).message : '';
}

/**
 * The status and message a client may see for an error. Raw database text,
 * PostgREST internals and programming errors are replaced with plain
 * sentences; validation and business-rule messages pass through.
 */
export function publicError(err: unknown): { status: 400 | 403 | 404 | 409 | 429 | 500; message: string } {
  if (err instanceof UserError) return { status: err.status, message: err.message };
  if (err instanceof z.ZodError) {
    return {
      status: 400,
      message: err.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message)).join(' '),
    };
  }
  const code = errorCode(err);
  const message = errorMessage(err);
  if (/^[0-9A-Z]{5}$/.test(code)) {
    if (RAW_DATABASE_MESSAGE.test(message) || !message) {
      return { status: STATUS_BY_SQLSTATE[code] || 400, message: DATABASE_MESSAGES[code] || 'The request could not be saved.' };
    }
    // A sentence raised by one of the app's own database functions.
    return { status: STATUS_BY_SQLSTATE[code] || 400, message };
  }
  if (code.startsWith('PGRST')) {
    return { status: 400, message: 'The request could not be completed.' };
  }
  // A Supabase client error without a SQLSTATE is a transport or PostgREST
  // failure, never a message for people.
  if (err && typeof err === 'object' && ('details' in err || 'hint' in err || (err as any).name === 'PostgrestError' || (err as any).name === 'AuthApiError')) {
    return { status: 500, message: 'An unexpected error occurred. Please try again later.' };
  }
  if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError || err instanceof RangeError) {
    return { status: 500, message: 'An unexpected error occurred. Please try again later.' };
  }
  if (err instanceof Error && message) {
    // Services still throw plain Errors with sentences written for people.
    return { status: 400, message };
  }
  return { status: 500, message: 'An unexpected error occurred. Please try again later.' };
}


/** True when the error carries Postgres's own constraint wording, which can include row values. */
export function isRawDatabaseError(err: unknown): boolean {
  const code = errorCode(err);
  return /^[0-9A-Z]{5}$/.test(code) && RAW_DATABASE_MESSAGE.test(errorMessage(err));
}

/** The message a client may see for an error. */
export function publicMessage(err: unknown): string {
  return publicError(err).message;
}
