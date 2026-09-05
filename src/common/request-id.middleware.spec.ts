import type { NextFunction, Response } from 'express';
import { RequestIdMiddleware, type RequestWithId } from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  const middleware = new RequestIdMiddleware();
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const run = (
    headers: Record<string, string>,
  ): { req: RequestWithId; res: { setHeader: jest.Mock } } => {
    const req = { headers, method: 'GET', url: '/x' } as unknown as RequestWithId;
    const res = { setHeader: jest.fn() };
    middleware.use(req, res as unknown as Response, jest.fn() as unknown as NextFunction);
    return { req, res: { setHeader: res.setHeader } };
  };

  it('keeps a caller-supplied valid UUID request id', () => {
    const { req, res } = run({ 'x-request-id': '123e4567-e89b-42d3-a452-426614174000' });
    expect(req.requestId).toBe('123e4567-e89b-42d3-a452-426614174000');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  it('mints a fresh UUID when the header is missing or malformed', () => {
    const cases: Array<Record<string, string>> = [{}, { 'x-request-id': 'not-a-uuid' }];
    for (const headers of cases) {
      const { req } = run(headers);
      expect(req.requestId).toMatch(UUID_PATTERN);
    }
  });
});
