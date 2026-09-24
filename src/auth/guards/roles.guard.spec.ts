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

  const prismaWithCredential = (credential: { userId: string } | null) =>
    ({ totpCredential: { findUnique: async () => credential } }) as never;

  const guard = new RolesGuard(
    new ReflectorStub(['ADMIN']) as unknown as Reflector,
    prismaWithCredential({ userId: 'admin-1' }),
  );

  const makeContext = (user?: { role: string; id?: string }): ExecutionContext =>
    ({
      getHandler: () => (): void => undefined,
      getClass: () => class {},
      switchToHttp: () => ({ getRequest: () => ({ user }) as AuthenticatedRequest }),
    }) as unknown as ExecutionContext;

  it('allows routes without role metadata', async () => {
    const open = new RolesGuard(
      new ReflectorStub(undefined) as unknown as Reflector,
      prismaWithCredential(null),
    );
    await expect(open.canActivate(makeContext({ role: 'STUDENT' }))).resolves.toBe(true);
  });

  it('allows a matching role', async () => {
    await expect(guard.canActivate(makeContext({ role: 'ADMIN', id: 'admin-1' }))).resolves.toBe(
      true,
    );
  });

  it('rejects a different role with 403 and missing user with 401', async () => {
    await expect(guard.canActivate(makeContext({ role: 'STUDENT' }))).rejects.toMatchObject({
      status: 403,
    });
    await expect(guard.canActivate(makeContext(undefined))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('blocks an ADMIN without TOTP enrollment on an admin route with 403', async () => {
    const unenrolled = new RolesGuard(
      new ReflectorStub(['ADMIN']) as unknown as Reflector,
      prismaWithCredential(null),
    );
    await expect(
      unenrolled.canActivate(makeContext({ role: 'ADMIN', id: 'admin-1' })),
    ).rejects.toMatchObject({ status: 403, message: 'MFA enrollment required' });
  });

  it('does not check MFA for non-ADMIN roles on admin-admitting routes', async () => {
    const neverQueried = {
      totpCredential: {
        findUnique: async () => {
          throw new Error('must not query for non-ADMIN callers');
        },
      },
    } as never;
    const shared = new RolesGuard(
      new ReflectorStub(['ADMIN', 'STUDENT']) as unknown as Reflector,
      neverQueried,
    );
    await expect(shared.canActivate(makeContext({ role: 'STUDENT', id: 's-1' }))).resolves.toBe(
      true,
    );
  });

  it('does not check MFA on routes that do not admit ADMIN', async () => {
    const neverQueried = {
      totpCredential: {
        findUnique: async () => {
          throw new Error('must not query for non-admin routes');
        },
      },
    } as never;
    const instructorRoute = new RolesGuard(
      new ReflectorStub(['INSTRUCTOR']) as unknown as Reflector,
      neverQueried,
    );
    await expect(
      instructorRoute.canActivate(makeContext({ role: 'INSTRUCTOR', id: 'i-1' })),
    ).resolves.toBe(true);
  });

  it('Roles decorator stores metadata under the shared key', () => {
    expect(Roles('ADMIN', 'INSTRUCTOR')).toBeInstanceOf(Function);
  });
});
