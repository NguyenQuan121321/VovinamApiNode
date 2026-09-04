import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import type { Response } from 'express';
import { DEFAULT_STATUS_MESSAGES, envelope, SKIP_ENVELOPE_KEY, type Envelope } from './envelope';

/**
 * Wraps every successful handler payload into the uniform envelope
 * {"code","message","data"} (plan section 9). Handlers marked @SkipEnvelope()
 * pass through untouched.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, T | Envelope<unknown>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<T | Envelope<unknown>> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data: T): T | Envelope<unknown> => {
        const status = context.switchToHttp().getResponse<Response>().statusCode;
        if (status < 200 || status >= 300) {
          return data;
        }
        return envelope<T | null>(data ?? null, status, DEFAULT_STATUS_MESSAGES[status] ?? 'OK');
      }),
    );
  }
}
