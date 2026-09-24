import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { AuthIpThrottleGuard } from './auth-ip-throttle.guard';
import { InMemorySharedStore } from '../common/shared-store';

describe('AuthIpThrottleGuard', () => {
  const makeGuard = (max: number) =>
    new AuthIpThrottleGuard(new InMemorySharedStore(), {
      authIpLimitMax: max,
      authIpLimitTtlSeconds: 60,
    });

  const makeContext = (ip: string): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ ip }) }),
    }) as unknown as ExecutionContext;

  it('allows requests under the per-IP limit', () => {
    const guard = makeGuard(3);
    expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
    expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
    expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
  });

  it('rejects with 429 once the per-IP window budget is exceeded', () => {
    const guard = makeGuard(3);
    for (let i = 0; i < 3; i += 1) {
      guard.canActivate(makeContext('1.2.3.4'));
    }
    expect(() => guard.canActivate(makeContext('1.2.3.4'))).toThrow(HttpException);
    expect(() => guard.canActivate(makeContext('1.2.3.4'))).toThrow(/Too many requests/);
  });

  it('keeps other client IPs unaffected by a blocked bucket', () => {
    const guard = makeGuard(1);
    guard.canActivate(makeContext('1.2.3.4'));
    expect(() => guard.canActivate(makeContext('1.2.3.4'))).toThrow(HttpException);
    expect(guard.canActivate(makeContext('5.6.7.8'))).toBe(true);
  });

  it('collapses IPv6 addresses sharing a /64 into one bucket (S-10)', () => {
    const guard = makeGuard(1);
    guard.canActivate(makeContext('2001:db8:aaaa::1'));
    expect(() => guard.canActivate(makeContext('2001:db8:aaaa::2'))).toThrow(HttpException);
    expect(guard.canActivate(makeContext('2001:db8:bbbb::1'))).toBe(true);
  });
});
