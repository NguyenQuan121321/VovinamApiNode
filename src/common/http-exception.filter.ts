import type { Logger } from 'pino';
import {
  Catch,
  HttpException,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { APP_LOGGER } from '../logging/pino-logger.factory';
import { DEFAULT_STATUS_MESSAGES, envelope } from './envelope';
import type { RequestWithId } from './request-id.middleware';

/**
 * Maps every error onto the uniform envelope. User-facing messages stay short and generic;
 * internal detail (stack, driver errors) goes to the pino log only.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Inject(APP_LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const { status, message } = resolveHttpException(exception);

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId: request.requestId, url: request.url },
        'unhandled_exception',
      );
    } else {
      this.logger.warn(
        { requestId: request.requestId, url: request.url, status },
        'request_failed',
      );
    }

    response.status(status).json(envelope(null, status, message));
  }
}

interface ResolvedError {
  status: number;
  message: string;
}

function resolveHttpException(exception: unknown): ResolvedError {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return { status, message: body };
    }
    const message = propertyOf(body, 'message');
    if (typeof message === 'string') {
      return { status, message };
    }
    if (Array.isArray(message)) {
      return { status, message: message.join('; ') };
    }
    return { status, message: DEFAULT_STATUS_MESSAGES[status] ?? 'Error' };
  }
  // Express/body-parser errors (e.g. 413 entity too large) carry a numeric status
  // outside the HttpException hierarchy.
  const status = propertyOf(exception, 'status');
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return { status, message: DEFAULT_STATUS_MESSAGES[status] ?? 'Request failed' };
  }
  return { status: 500, message: DEFAULT_STATUS_MESSAGES[500] ?? 'Internal server error' };
}

function propertyOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
