import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Registry } from 'prom-client';
import type { EnvService } from '../config/env.service';
import { MetricsController } from './metrics.controller';

describe('MetricsController', () => {
  const registry = { metrics: jest.fn(async () => '# HELP http_request_duration_seconds test') };
  const token = 'metrics-token-0123456789';

  const makeController = (metricsToken: string | undefined): MetricsController =>
    new MetricsController(
      { metricsToken } as unknown as EnvService,
      registry as unknown as Registry,
    );

  it('returns raw scrape output for the correct bearer token', async () => {
    await expect(makeController(token).getMetrics(`Bearer ${token}`)).resolves.toContain(
      'http_request_duration_seconds',
    );
  });

  it('rejects a missing or wrong bearer token with 401', async () => {
    await expect(makeController(token).getMetrics(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(makeController(token).getMetrics('Bearer wrong-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('presents as a missing route when no token is configured', async () => {
    await expect(makeController(undefined).getMetrics(`Bearer ${token}`)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
