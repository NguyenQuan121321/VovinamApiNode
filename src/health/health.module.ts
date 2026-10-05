import { Module } from '@nestjs/common';
import type { Registry } from 'prom-client';
import { HealthController } from './health.controller';
import { VersionController } from './version.controller';
import { MetricsController } from './metrics.controller';
import { createMetricsRegistry, METRICS_REGISTRY } from './metrics.registry';

@Module({
  controllers: [HealthController, MetricsController, VersionController],
  providers: [{ provide: METRICS_REGISTRY, useFactory: (): Registry => createMetricsRegistry() }],
  exports: [METRICS_REGISTRY],
})
export class HealthModule {}
