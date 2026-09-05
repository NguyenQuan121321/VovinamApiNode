import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Registry } from 'prom-client';
import { EnvService } from '../config/env.service';
import { constantTimeEquals } from '../common/crypto';
import { SkipEnvelope } from '../common/envelope';
import { METRICS_REGISTRY } from './metrics.registry';

const BEARER_PREFIX = 'Bearer ';

@Controller()
export class MetricsController {
  constructor(
    private readonly env: EnvService,
    @Inject(METRICS_REGISTRY) private readonly registry: Registry,
  ) {}

  @Get('metrics')
  @SkipEnvelope()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(@Headers('authorization') authorization?: string): Promise<string> {
    const expected = this.env.metricsToken;
    if (expected === undefined) {
      // No token configured (allowed outside production): present as a missing route.
      throw new NotFoundException('Not found');
    }
    const provided =
      authorization !== undefined && authorization.startsWith(BEARER_PREFIX)
        ? authorization.slice(BEARER_PREFIX.length)
        : '';
    if (provided === '' || !constantTimeEquals(provided, expected)) {
      throw new UnauthorizedException('Unauthorized');
    }
    return this.registry.metrics();
  }
}
