import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { InMemorySharedStore } from '../common/shared-store';
import { EnvService } from '../config/env.service';
import type { Env } from '../config/env.validation';
import { AuditService } from './audit/audit.service';
import { AuthService, INVALID_CREDENTIALS_MESSAGE, INVALID_TOKEN_MESSAGE } from './auth.service';
import { RefreshTokenService } from './domain/refresh-token.service';
import { TokenService } from './domain/token.service';
import type { MailMessage, MailPort } from './mail/mail.port';

const JWT_SECRET = 'a'.repeat(64);

function makePrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    refreshToken: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    totpCredential: { findUnique: jest.fn(async () => null) },
    auditLog: {
      count: jest.fn(async () => 1),
      createMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => []),
    },
    usedToken: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock) {
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg as Promise<unknown>[])
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  const env = new EnvService(
    new ConfigService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_SECRET,
      JWT_ISSUER: 'vovinam-api',
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '30d',
      MAX_LOGIN_ATTEMPTS: 5,
      LOGIN_LOCKOUT_DURATION: '15m',
    }) as ConfigService<Env, true>,
  );
  const tokens = new TokenService(env);
  const audit = new AuditService(prisma as never);
  const sentMail: Array<MailMessage> = [];
  const mail: MailPort = {
    send: jest.fn(async (message: MailMessage) => {
      sentMail.push(message);
    }),
  };
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const service = new AuthService(
    prisma as never,
    env,
    tokens,
    new RefreshTokenService(),
    audit,
    mail,
    new InMemorySharedStore(),
    logger as never,
  );
  return { service, tokens, sentMail, prisma };
}

const verifiedUser = (overrides: Record<string, unknown> = {}) => ({
  id: 'u-1',
  email: 'parent@example.com',
  role: 'PARENT',
  passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz012345678901234567890123456789012', // not a real hash; compare mocked
  emailVerifiedAt: new Date(),
  failedLoginAttempts: 0,
  lockedUntil: null,
  pwdVersion: 1,
  isActive: true,
  deletedAt: null,
  createdAt: new Date(),
  ...overrides,
});

const registerDto = {
  email: 'parent@example.com',
  password: 'Str0ngPass',
  role: 'PARENT' as const,
  fullName: 'Phu Huynh',
  dateOfBirth: '1990-05-10',
};

describe('AuthService — registration', () => {
  let prisma: PrismaMock;
  let service: AuthService;
  let sentMail: Array<MailMessage>;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, sentMail } = makeService(prisma));
  });

  it('rejects weak passwords and underage students before touching the database', async () => {
    await expect(service.register({ ...registerDto, password: 'short1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.register({ ...registerDto, role: 'STUDENT', dateOfBirth: '2015-01-01' }),
    ).rejects.toThrow(/under 18/);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('creates the account, mails a verification token and audits it', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(verifiedUser());
    const result = await service.register(registerDto, '10.0.0.1');
    expect(result).toEqual({ email: 'parent@example.com', requiresVerification: true });
    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]?.templateCode).toBe('VERIFY_EMAIL');
    expect(sentMail[0]?.to).toBe('parent@example.com');
  });

  it('responds identically for duplicate emails and notifies the existing account', async () => {
    prisma.user.findUnique.mockResolvedValue(verifiedUser());
    const result = await service.register(registerDto);
    expect(result).toEqual({ email: 'parent@example.com', requiresVerification: true });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(sentMail[0]?.templateCode).toBe('REGISTER_DUPLICATE');
  });
});

describe('AuthService — single-use token flows', () => {
  let prisma: PrismaMock;
  let service: AuthService;
  let tokens: TokenService;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, tokens } = makeService(prisma));
    prisma.user.findUnique.mockResolvedValue(verifiedUser());
  });

  it('consumes a verification token exactly once', async () => {
    const token = tokens.signActionToken('u-1', 'VERIFY_EMAIL', 60);
    await expect(service.verifyEmail({ token })).resolves.toEqual({ emailVerified: true });
    (prisma.usedToken.create as jest.Mock).mockRejectedValueOnce(new Error('P2002'));
    await expect(service.verifyEmail({ token })).rejects.toThrow(INVALID_TOKEN_MESSAGE);
  });

  it('rejects action tokens with the wrong purpose or signature', async () => {
    const resetToken = tokens.signActionToken('u-1', 'RESET_PASSWORD', 60);
    await expect(service.verifyEmail({ token: resetToken })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.verifyEmail({ token: 'garbage' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('resend and forgot-password stay silent about unknown accounts', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.resendVerification({ email: 'nobody@example.com' })).resolves.toEqual({
      sent: true,
    });
    await expect(service.forgotPassword({ email: 'nobody@example.com' })).resolves.toEqual({
      sent: true,
    });
  });

  it('reset password rotates pwd_version, revokes sessions and consumes the token', async () => {
    const token = tokens.signActionToken('u-1', 'RESET_PASSWORD', 60);
    const result = await service.resetPassword({ token, password: 'NewPass99' });
    expect(result).toEqual({ reset: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' } }),
    );
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', revoked: false },
      data: { revoked: true },
    });
    (prisma.usedToken.create as jest.Mock).mockRejectedValueOnce(new Error('P2002'));
    await expect(service.resetPassword({ token, password: 'NewPass99' })).rejects.toThrow(
      INVALID_TOKEN_MESSAGE,
    );
  });
});

describe('AuthService — login, lockout and sessions', () => {
  let prisma: PrismaMock;
  let service: AuthService;
  let sentMail: Array<MailMessage>;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, sentMail } = makeService(prisma));
    prisma.user.findUnique.mockResolvedValue(verifiedUser());
    prisma.user.findUniqueOrThrow.mockResolvedValue(verifiedUser());
    prisma.session.create.mockResolvedValue({ id: 's-1' });
    jest
      .spyOn(bcrypt, 'compare')
      .mockImplementation(async (password: string) => password === 'Correct1');
  });

  it('equalizes timing for unknown accounts and fails uniformly', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'ghost@example.com', password: 'Whatever1' }),
    ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(sentMail).toHaveLength(0);
  });

  it('counts failures and locks the account at the threshold', async () => {
    prisma.user.findUnique.mockResolvedValue(
      verifiedUser({ passwordHash: 'hash', failedLoginAttempts: 4 }),
    );
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    await expect(
      service.login({ email: 'parent@example.com', password: 'Wrong999' }),
    ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ failedLoginAttempts: 0, lockedUntil: expect.any(Date) }),
      }),
    );
    expect(sentMail.some((m) => m.templateCode === 'ACCOUNT_LOCKED')).toBe(true);
  });

  it('rejects correct passwords for locked, disabled and unverified accounts with state mails', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    prisma.user.findUnique.mockResolvedValue(
      verifiedUser({ lockedUntil: new Date(Date.now() + 600_000) }),
    );
    await expect(
      service.login({ email: 'parent@example.com', password: 'Correct1' }),
    ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(sentMail.some((m) => m.templateCode === 'LOGIN_BLOCKED_LOCKED')).toBe(true);

    prisma.user.findUnique.mockResolvedValue(verifiedUser({ isActive: false }));
    await expect(
      service.login({ email: 'parent@example.com', password: 'Correct1' }),
    ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(sentMail.some((m) => m.templateCode === 'LOGIN_BLOCKED_DISABLED')).toBe(true);

    prisma.user.findUnique.mockResolvedValue(verifiedUser({ emailVerifiedAt: null }));
    await expect(
      service.login({ email: 'parent@example.com', password: 'Correct1' }),
    ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(sentMail.some((m) => m.templateCode === 'LOGIN_BLOCKED_UNVERIFIED')).toBe(true);
  });

  it('issues tokens on success and sends a new-IP alert the first time', async () => {
    prisma.user.findUnique.mockResolvedValue(verifiedUser());
    prisma.auditLog.count.mockResolvedValue(0);
    const result = await service.login(
      { email: 'parent@example.com', password: 'Correct1' },
      '203.0.113.9',
    );
    expect(result.mfaRequired).toBe(false);
    expect(result.tokens?.accessToken).toBeDefined();
    expect(result.tokens?.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sentMail.some((m) => m.templateCode === 'LOGIN_NEW_IP')).toBe(true);
  });

  it('returns mfa_pending instead of tokens when TOTP is enabled', async () => {
    prisma.user.findUnique.mockResolvedValue(verifiedUser());
    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue({ userId: 'u-1' });
    const result = await service.login({ email: 'parent@example.com', password: 'Correct1' });
    expect(result.mfaRequired).toBe(true);
    expect(result.tokens).toBeUndefined();
    expect(result.mfaToken).toBeDefined();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('rotates refresh tokens and revokes everything on replay', async () => {
    const firstRefresh = 'A'.repeat(43);
    prisma.refreshToken.findUnique
      .mockResolvedValueOnce({
        id: 'rt-1',
        revoked: false,
        expiresAt: new Date(Date.now() + 86_400_000),
        sessionId: 's-1',
        user: verifiedUser(),
      })
      .mockResolvedValueOnce({
        id: 'rt-1',
        revoked: true,
        expiresAt: new Date(Date.now() + 86_400_000),
        sessionId: 's-1',
        user: verifiedUser(),
      });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.session.findUniqueOrThrow.mockResolvedValue({
      id: 's-1',
      expiresAt: new Date(Date.now() + 86_400_000),
      revoked: false,
    });
    prisma.refreshToken.create.mockResolvedValue({});

    const rotated = await service.refresh(firstRefresh);
    expect(rotated.refreshToken).not.toBe(firstRefresh);
    expect(rotated.accessToken).toBeDefined();

    // Replay of the same (now revoked) token must revoke ALL sessions and alert.
    await expect(service.refresh(firstRefresh)).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(prisma.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u-1', revoked: false },
      data: { revoked: true },
    });
    expect(sentMail.some((m) => m.templateCode === 'TOKEN_REUSE')).toBe(true);
  });

  it('treats a lost concurrent-rotation race as reuse', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-2',
      revoked: false,
      expiresAt: new Date(Date.now() + 86_400_000),
      sessionId: 's-1',
      user: verifiedUser(),
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.refresh('B'.repeat(43))).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(prisma.session.updateMany).toHaveBeenCalled();
  });

  it('logout denylists the current jti and revokes the session; logout-all bumps pwd_version', async () => {
    const tokens = new TokenService(makeEnv());
    const accessToken = tokens.signAccessToken({ id: 'u-1', role: 'PARENT', pwdVersion: 1 }, 's-1');
    const claims = tokens.verify(accessToken, 'access');
    await expect(service.logout(accessToken, claims.jti as string, 's-1')).resolves.toEqual({
      loggedOut: true,
    });
    expect(prisma.session.updateMany).toHaveBeenCalled();

    await expect(service.logoutAll('u-1', claims.jti as string)).resolves.toEqual({
      loggedOut: true,
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pwdVersion: { increment: 1 } }) }),
    );
  });

  it('revokeSession returns uniform 401 for foreign or revoked sessions', async () => {
    prisma.session.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.revokeSession('u-1', 'someone-elses')).rejects.toThrow(
      INVALID_CREDENTIALS_MESSAGE,
    );
    prisma.session.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.revokeSession('u-1', 's-1')).resolves.toBeUndefined();
  });

  it('lists active sessions and paginates the audit log', async () => {
    prisma.session.findMany.mockResolvedValue([
      {
        id: 's-1',
        ip: '1.2.3.4',
        userAgent: 'ua',
        deviceName: null,
        lastActiveAt: new Date(),
        createdAt: new Date(),
      },
    ]);
    expect((await service.listSessions('u-1')).length).toBe(1);

    prisma.$transaction.mockResolvedValue([
      [{ id: 1, event: 'login', ip: null, success: true, detail: null, createdAt: new Date() }],
      1,
    ]);
    const page = await service.auditLog('u-1', 1, 20);
    expect(page).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(page.items.length).toBe(1);
  });

  it('covers refresh edge branches: expiry, revoked session, disabled user, no ip', async () => {
    const userRow = verifiedUser();
    // Expired refresh token.
    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-1',
      revoked: false,
      expiresAt: new Date(Date.now() - 1000),
      sessionId: 's-1',
      user: userRow,
    });
    await expect(service.refresh('C'.repeat(43))).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

    // Revoked parent session.
    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-2',
      revoked: false,
      expiresAt: new Date(Date.now() + 86_400_000),
      sessionId: 's-1',
      user: userRow,
    });
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.session.findUniqueOrThrow.mockResolvedValue({
      id: 's-1',
      expiresAt: new Date(Date.now() + 86_400_000),
      revoked: true,
    });
    await expect(service.refresh('D'.repeat(43))).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

    // Disabled user with a live session.
    prisma.session.findUniqueOrThrow.mockResolvedValue({
      id: 's-1',
      expiresAt: new Date(Date.now() + 86_400_000),
      revoked: false,
    });
    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-3',
      revoked: false,
      expiresAt: new Date(Date.now() + 86_400_000),
      sessionId: 's-1',
      user: verifiedUser({ isActive: false }),
    });
    await expect(service.refresh('E'.repeat(43))).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

    // Successful rotation without an IP (alert skipped) and notify() failure tolerated.
    prisma.refreshToken.findUnique.mockResolvedValueOnce({
      id: 'rt-4',
      revoked: false,
      expiresAt: new Date(Date.now() + 86_400_000),
      sessionId: 's-1',
      user: userRow,
    });
    prisma.session.findUniqueOrThrow.mockResolvedValue({
      id: 's-1',
      expiresAt: new Date(Date.now() + 86_400_000),
      revoked: false,
    });
    (bcrypt.compare as jest.Mock).mockImplementation(async () => true);
    const rotated = await service.refresh('F'.repeat(43));
    expect(rotated.sessionId).toBe('s-1');
  });

  it('resend and forgot-password ignore verified or deactivated accounts', async () => {
    prisma.user.findUnique.mockResolvedValue(verifiedUser({ emailVerifiedAt: new Date() }));
    await service.resendVerification({ email: 'parent@example.com' });
    expect(sentMail).toHaveLength(0);

    prisma.user.findUnique.mockResolvedValue(verifiedUser({ deletedAt: new Date() }));
    await service.forgotPassword({ email: 'parent@example.com' });
    expect(sentMail).toHaveLength(0);
  });
});

function makeEnv(): EnvService {
  return new EnvService(
    new ConfigService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_SECRET,
      JWT_ISSUER: 'vovinam-api',
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '30d',
    }) as ConfigService<Env, true>,
  );
}

describe('AuthService — unauthorized exception contract', () => {
  it('exports uniform messages', () => {
    expect(INVALID_CREDENTIALS_MESSAGE).toBe('Invalid email or password');
    expect(new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE).getStatus()).toBe(401);
  });
});
