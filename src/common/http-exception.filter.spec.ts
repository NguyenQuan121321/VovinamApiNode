import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type { Logger } from 'pino';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as Logger;
  const filter = new HttpExceptionFilter(logger);

  interface CapturedResponse {
    statusCode: number;
    body: unknown;
  }

  const makeResponse = (): CapturedResponse => {
    const captured: CapturedResponse = { statusCode: 0, body: undefined };
    const handlers = {
      status(code: number): CapturedResponse {
        captured.statusCode = code;
        return captured;
      },
      json(body: unknown): void {
        captured.body = body;
      },
    };
    return Object.assign(captured, handlers);
  };

  const makeHost = (res: unknown): Parameters<typeof filter.catch>[1] =>
    ({
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ requestId: 'req-1', url: '/api/v1/x' }),
      }),
    }) as Parameters<typeof filter.catch>[1];

  it('joins ValidationPipe array messages into one short message', () => {
    const res = makeResponse();
    filter.catch(
      new BadRequestException(['email must be an email', 'password must contain a digit']),
      makeHost(res),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      code: 400,
      message: 'email must be an email; password must contain a digit',
      data: null,
    });
  });

  it('uses the default short message when the exception carries none', () => {
    const res = makeResponse();
    filter.catch(new UnauthorizedException(), makeHost(res));
    expect(res.body).toEqual({ code: 401, message: 'Unauthorized', data: null });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('maps non-HttpException errors with an HTTP status (body-parser 413)', () => {
    const res = makeResponse();
    const payloadTooLarge = Object.assign(new Error('request entity too large'), { status: 413 });
    filter.catch(payloadTooLarge, makeHost(res));
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ code: 413, message: 'Payload too large', data: null });
  });

  it('maps unknown errors to a generic 500 without leaking internals', () => {
    const res = makeResponse();
    filter.catch(new Error('postgres password is hunter2'), makeHost(res));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ code: 500, message: 'Internal server error', data: null });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
