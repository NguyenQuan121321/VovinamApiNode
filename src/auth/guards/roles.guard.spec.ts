import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';
import type { AuthenticatedRequest } from './authenticated-request';

describe('RolesGuard', () => {
  class ReflectorStub {
    constructor(private readonly metadata?: string[]) {}
    getAllAndOverride(): string[] | undefined {
      return this.metadata;
    }
  }

  const guard = new RolesGuard(new ReflectorStub(['ADMIN']) as unknown as Reflector);

  const makeContext = (user?: { role: string }): ExecutionContext =>
    ({
      getHandler: () => (): void => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) as AuthenticatedRequest }),
    }) as unknown as ExecutionContext;

  it('allows routes without role metadata', () => {
    const open = new RolesGuard(new ReflectorStub(undefined) as unknown as Reflector);
    expect(open.canActivate(makeContext({ role: 'STUDENT' }))).toBe(true);
  });

  it('allows a matching role', () => {
    expect(guard.canActivate(makeContext({ role: 'ADMIN' }))).toBe(true);
  });

  it('rejects a different role with 403 and missing user with 401', () => {
    expect(() => guard.canActivate(makeContext({ role: 'STUDENT' }))).toThrow(
      Object.assign(new Error('Forbidden'), { status: 403 }),
    );
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(
      Object.assign(new Error('Unauthorized'), { status: 401 }),
    );
  });

  it('Roles decorator stores metadata under the shared key', () => {
    expect(Roles('ADMIN', 'INSTRUCTOR')).toBeInstanceOf(Function);
  });
});
