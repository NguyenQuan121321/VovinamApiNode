import { EventEmitter } from 'node:events';
import type { NextFunction, Request, Response } from 'express';
import { Registry } from 'prom-client';
import { MetricsMiddleware } from './metrics.middleware';

describe('MetricsMiddleware', () => {
  it('observes duration with the matched route pattern on finish', async () => {
    const registry = new Registry();
    const middleware = new MetricsMiddleware(registry);
    const req = {
      method: 'GET',
      path: '/api/v1/students',
      baseUrl: '/api/v1',
      route: { path: '/students' },
    };
    const res = new EventEmitter();
    middleware.use(
      req as unknown as Request,
      res as unknown as Response,
      jest.fn() as NextFunction,
    );
    res.emit('finish');

    const output = await registry.metrics();
    expect(output).toContain('http_request_duration_seconds');
    expect(output).toContain('route="/api/v1/students"');
  });

  it('labels unmatched requests as unmatched', async () => {
    const registry = new Registry();
    const middleware = new MetricsMiddleware(registry);
    const req = { method: 'GET', path: '/nope', baseUrl: '', route: undefined };
    const res = new EventEmitter();
    middleware.use(
      req as unknown as Request,
      res as unknown as Response,
      jest.fn() as NextFunction,
    );
    res.emit('finish');

    const output = await registry.metrics();
    expect(output).toContain('route="unmatched"');
  });

  it('does not observe the /metrics scrape itself', async () => {
    const registry = new Registry();
    const middleware = new MetricsMiddleware(registry);
    const req = { method: 'GET', path: '/metrics', baseUrl: '', route: undefined };
    const res = new EventEmitter();
    middleware.use(
      req as unknown as Request,
      res as unknown as Response,
      jest.fn() as NextFunction,
    );
    res.emit('finish');

    const output = await registry.metrics();
    // The metric is registered (HELP/TYPE metadata) but must carry zero observations.
    expect(output).toContain('# HELP http_request_duration_seconds');
    expect(output).not.toContain('http_request_duration_seconds_bucket{');
  });
});
