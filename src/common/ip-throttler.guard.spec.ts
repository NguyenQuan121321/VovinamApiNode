import { IpThrottlerGuard } from './ip-throttler.guard';

/** The guard's only own logic is tracker resolution; bypass the DI constructor. */
function makeGuard(): { getTracker(req: Record<string, unknown>): Promise<string> } {
  return Object.create(IpThrottlerGuard.prototype);
}

describe('IpThrottlerGuard tracker', () => {
  const guard = makeGuard();

  it('keys IPv4 clients by their exact address', async () => {
    await expect(guard.getTracker({ ip: '203.0.113.7' })).resolves.toBe('203.0.113.7');
  });

  it('collapses IPv6 addresses sharing a /64 into one bucket (S-10)', async () => {
    await expect(guard.getTracker({ ip: '2001:db8:aaaa::1' })).resolves.toBe(
      'v6-2001:0db8:aaaa:0000',
    );
    await expect(guard.getTracker({ ip: '2001:db8:aaaa::ffff' })).resolves.toBe(
      'v6-2001:0db8:aaaa:0000',
    );
    await expect(guard.getTracker({ ip: '2001:db8:bbbb::1' })).resolves.toBe(
      'v6-2001:0db8:bbbb:0000',
    );
  });

  it('treats IPv4-mapped IPv6 as plain IPv4 so mapped clients stay distinct', async () => {
    await expect(guard.getTracker({ ip: '::ffff:203.0.113.7' })).resolves.toBe('203.0.113.7');
  });

  it('falls back to the unknown bucket when no address resolved', async () => {
    await expect(guard.getTracker({})).resolves.toBe('unknown');
  });
});
