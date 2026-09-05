import type { ExecutionContext } from '@nestjs/common';
import { InMemorySharedStore } from '../../common/shared-store';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedRequest } from './authenticated-request';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { TokenService } from '../domain/token.service';

describe('JwtAuthGuard', () => {
  const validClaims = { sub: 'u-1', jti: 'j-1', sid: 's-1', pwdver: 1 };
  const activeUser = { id: 'u-1', role: 'STUDENT', pwdVersion: 1, deletedAt: null, isActive: true };
  const activeSession = { id: 's-1', revoked: false, expiresAt: new Date(Date.now() + 86_400_000) };

  const store = new InMemorySharedStore();
  const tokenService = { verify: jest.fn() };
  const prisma = {
    user: { findUnique: jest.fn() },
    session: { findUnique: jest.fn() },
  };
  const guard = new JwtAuthGuard(
    tokenService as unknown as TokenService,
    prisma as unknown as PrismaService,
    store,
  );

  const makeContext = (headers: Record<string, string>): ExecutionContext => {
    const request: Partial<AuthenticatedRequest> = { headers };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    tokenService.verify.mockReturnValue(validClaims);
    prisma.user.findUnique.mockResolvedValue(activeUser);
    prisma.session.findUnique.mockResolvedValue(activeSession);
  });

  it('attaches the authenticated user on success', async () => {
    const ctx = makeContext({ authorization: 'Bearer tok' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest() as AuthenticatedRequest).user).toEqual({
      id: 'u-1',
      role: 'STUDENT',
      sessionId: 's-1',
      jti: 'j-1',
    });
  });

  it('rejects missing or malformed authorization headers with 401', async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toThrow('Unauthorized');
    await expect(guard.canActivate(makeContext({ authorization: 'Basic abc' }))).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('rejects invalid signatures, denylisted jti and stale pwd_version uniformly', async () => {
    tokenService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    await expect(guard.canActivate(makeContext({ authorization: 'Bearer tok' }))).rejects.toThrow(
      'Unauthorized',
    );

    tokenService.verify.mockReturnValue(validClaims);
    store.set('jti:denylist:j-1', true, 60_000);
    await expect(guard.canActivate(makeContext({ authorization: 'Bearer tok' }))).rejects.toThrow(
      'Unauthorized',
    );
    store.delete('jti:denylist:j-1');

    prisma.user.findUnique.mockResolvedValue({ ...activeUser, pwdVersion: 2 });
    await expect(guard.canActivate(makeContext({ authorization: 'Bearer tok' }))).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('rejects deleted, deactivated users and revoked sessions', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({ ...activeUser, deletedAt: new Date() })
      .mockResolvedValueOnce({ ...activeUser, isActive: false })
      .mockResolvedValueOnce(null);
    prisma.session.findUnique.mockResolvedValue({ ...activeSession, revoked: true });
    for (let i = 0; i < 3; i += 1) {
      await expect(guard.canActivate(makeContext({ authorization: 'Bearer tok' }))).rejects.toThrow(
        'Unauthorized',
      );
    }
    prisma.user.findUnique.mockResolvedValue(activeUser);
    await expect(guard.canActivate(makeContext({ authorization: 'Bearer tok' }))).rejects.toThrow(
      'Unauthorized',
    );
  });
});
