import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { Histogram, type Registry } from 'prom-client';
import type { NextFunction, Request, Response } from 'express';
import { METRICS_REGISTRY } from './metrics.registry';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  private readonly requestDuration: Histogram<string>;

  constructor(@Inject(METRICS_REGISTRY) registry: Registry) {
    this.requestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      registers: [registry],
    });
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (req.path === '/metrics') {
      next();
      return;
    }
    const stop = this.requestDuration.startTimer({ method: req.method });
    res.on('finish', () => {
      // Cardinality control: label by the matched route pattern, never the raw URL.
      const route = req.route !== undefined ? `${req.baseUrl}${req.route.path}` : 'unmatched';
      stop({ route, status: String(res.statusCode) });
    });
    next();
  }
}
