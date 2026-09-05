import { createMetricsRegistry } from './metrics.registry';

describe('createMetricsRegistry', () => {
  it('exposes default process metrics', async () => {
    const registry = createMetricsRegistry();
    const output = await registry.metrics();
    expect(output).toContain('process_');
  });
});
