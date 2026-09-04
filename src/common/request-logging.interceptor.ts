import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { tap, type Observable } from 'rxjs';
import type { Response } from 'express';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../logging/pino-logger.factory';
import type { RequestWithId } from './request-id.middleware';

const OPS_PATHS = new Set(['/healthz', '/readyz', '/metrics']);

/**
 * JSON access log for API traffic. Failed requests are logged by HttpExceptionFilter
 * instead: at error time the status code has not been written yet.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(@Inject(APP_LOGGER) private readonly logger: Logger) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    if (OPS_PATHS.has(request.path)) {
      return next.handle();
    }
    const startMs = Date.now();
    return next.handle().pipe(
      tap(() => {
        this.logger.info(
          {
            requestId: request.requestId,
            method: request.method,
            url: request.originalUrl,
            status: http.getResponse<Response>().statusCode,
            durationMs: Date.now() - startMs,
          },
          'http_request',
        );
      }),
    );
  }
}
