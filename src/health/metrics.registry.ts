import { collectDefaultMetrics, Registry } from 'prom-client';

export const METRICS_REGISTRY = Symbol('METRICS_REGISTRY');

export function createMetricsRegistry(): Registry {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  return registry;
}
