import type { ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import type { Logger } from 'pino';
import { RequestLoggingInterceptor } from './request-logging.interceptor';
import type { RequestWithId } from './request-id.middleware';

describe('RequestLoggingInterceptor', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
  const interceptor = new RequestLoggingInterceptor(logger);

  const makeContext = (path: string): ExecutionContext =>
    ({
      getHandler: () => (): unknown => undefined,
      getClass: () => class Dummy {},
      switchToHttp: () => ({
        getRequest: () =>
          ({
            path,
            requestId: 'req-1',
            method: 'GET',
            originalUrl: `/api/v1${path}`,
          }) as RequestWithId,
        getResponse: () => ({ statusCode: 200 }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs successful API requests with request id, status and duration', () => {
    interceptor.intercept(makeContext('/students'), { handle: () => of('ok') }).subscribe();
    expect(logger.info).toHaveBeenCalledTimes(1);
    const [payload, message] = (logger.info as jest.Mock).mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    expect(payload).toMatchObject({
      requestId: 'req-1',
      method: 'GET',
      url: '/api/v1/students',
      status: 200,
    });
    expect(typeof payload.durationMs).toBe('number');
    expect(message).toBe('http_request');
  });

  it('stays silent for ops paths (healthz/readyz/metrics)', () => {
    for (const path of ['/healthz', '/readyz', '/metrics']) {
      interceptor.intercept(makeContext(path), { handle: () => of('ok') }).subscribe();
    }
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('lets errors propagate untouched (the exception filter logs them)', () => {
    const output: unknown[] = [];
    interceptor
      .intercept(makeContext('/students'), { handle: () => throwError(() => new Error('boom')) })
      .subscribe({ error: (err: unknown) => output.push(err) });
    expect(output).toEqual([new Error('boom')]);
    expect(logger.info).not.toHaveBeenCalled();
  });
});
