import { SetMetadata } from '@nestjs/common';

/** Uniform response envelope (plan section 9): every API response wraps its payload here. */
export interface Envelope<T> {
  code: number;
  message: string;
  data: T;
}

export const SKIP_ENVELOPE_KEY = 'vovinam:skip-envelope';

export function envelope<T>(data: T, code: number, message: string): Envelope<T> {
  return { code, message, data };
}

/** Opts a handler out of the envelope; used by /metrics, which must emit raw Prometheus text. */
export function SkipEnvelope() {
  return SetMetadata(SKIP_ENVELOPE_KEY, true);
}

export const DEFAULT_STATUS_MESSAGES: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No content',
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  409: 'Conflict',
  413: 'Payload too large',
  422: 'Unprocessable entity',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};
