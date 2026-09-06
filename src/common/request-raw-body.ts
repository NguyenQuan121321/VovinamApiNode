import type { Request } from 'express';

/**
 * Request carrying the untouched raw body, captured by the body-parser verify
 * callback in bootstrap.ts so webhook signatures verify against the exact bytes
 * the gateway sent (plan 7.5).
 */
export interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}
