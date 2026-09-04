import { pino, type DestinationStream, type Logger } from 'pino';
import { EnvService } from '../config/env.service';

export const APP_LOGGER = Symbol('APP_LOGGER');

const REDACT_PATHS = [
  'password',
  'authorization',
  'token',
  'secret',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  '*.password',
  '*.token',
  '*.secret',
];

export function createAppLogger(env: EnvService, destination?: DestinationStream): Logger {
  const options = {
    level: env.isProduction ? 'info' : 'debug',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: null,
  };
  return destination === undefined ? pino(options) : pino(options, destination);
}
