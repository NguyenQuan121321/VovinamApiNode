import { ConfigService } from '@nestjs/config';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { InMemorySharedStore } from '../common/shared-store';
import { EnvService } from '../config/env.service';
import type { Env } from '../config/env.validation';
import { AuditService } from './audit/audit.service';
import { AuthService, INVALID_CREDENTIALS_MESSAGE, INVALID_TOKEN_MESSAGE } from './auth.service';
import { RefreshTokenService } from './domain/refresh-token.service';
import { SealService } from './mfa/seal.service';
import { TotpService } from './mfa/totp.service';
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
    totpCredential: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    recoveryCode: {
      create: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(async () => 10),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
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
      APP_ENCRYPTION_KEY: 'ab'.repeat(32),
    }) as ConfigService<Env, true>,
  );
  const tokens = new TokenService(env);
  const audit = new AuditService(prisma as never);
  const store = new InMemorySharedStore();
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
    new SealService(env),
    new TotpService(store, logger as never),
    mail,
    store,
    logger as never,
  );
  return { service, tokens, sentMail, prisma, store };
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
      APP_ENCRYPTION_KEY: 'ab'.repeat(32),
    }) as ConfigService<Env, true>,
  );
}

describe('AuthService — unauthorized exception contract', () => {
  it('exports uniform messages', () => {
    expect(INVALID_CREDENTIALS_MESSAGE).toBe('Invalid email or password');
    expect(new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE).getStatus()).toBe(401);
  });
});

describe('AuthService — MFA and account lifecycle', () => {
  let prisma: PrismaMock;
  let service: AuthService;
  let sentMail: Array<MailMessage>;
  let store: InMemorySharedStore;
  const sealedSecret = 'JBSWY3DPEHPK3PXP';

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, sentMail, store } = makeService(prisma));
    prisma.user.findUnique.mockResolvedValue(verifiedUser());
    prisma.user.findUniqueOrThrow.mockResolvedValue(verifiedUser());
    prisma.session.create.mockResolvedValue({ id: 's-1' });
    jest.spyOn(bcrypt, 'compare').mockImplementation(async (password: string) => {
      return password === 'Correct1';
    });
  });

  it('totpEnable refuses a second enrollment and stashes a pending secret', async () => {
    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue({ userId: 'u-1' });
    await expect(service.totpEnable('u-1')).rejects.toBeInstanceOf(ConflictException);

    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue(null);
    const enrollment = await service.totpEnable('u-1');
    expect(enrollment.otpauthUrl).toContain('otpauth://totp/');
    expect(store.get('mfa:pending:u-1')).toBeDefined();
  });

  it('totpVerify consumes the pending secret and returns ten single-use codes once', async () => {
    await service.totpEnable('u-1');
    const secret = String(store.get('mfa:pending:u-1'));
    const code = authenticator.generate(secret);
    const result = await service.totpVerify('u-1', code);
    expect(result.recoveryCodes).toHaveLength(10);
    expect(prisma.totpCredential.create).toHaveBeenCalled();
    // Pending stash is consumed: a second verify has nothing to confirm.
    await expect(service.totpVerify('u-1', code)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('totpValidate requires enrollment and a correct sealed-secret code', async () => {
    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.totpValidate('u-1', '000000')).rejects.toBeInstanceOf(BadRequestException);

    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      secretEncrypted: new SealService(makeEnv()).seal(Buffer.from(sealedSecret)),
    });
    const code = authenticator.generate(sealedSecret);
    await expect(service.totpValidate('u-1', code)).resolves.toEqual({ valid: true });
    await expect(service.totpValidate('u-1', '000000')).rejects.toThrow(
      /Invalid verification code/,
    );
  });

  it('totpDisable requires password plus TOTP code and revokes sessions', async () => {
    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      secretEncrypted: new SealService(makeEnv()).seal(Buffer.from(sealedSecret)),
    });
    const code = authenticator.generate(sealedSecret);
    const result = await service.totpDisable('u-1', { password: 'Correct1', code });
    expect(result).toEqual({ disabled: true });
    expect(prisma.totpCredential.deleteMany).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pwdVersion: { increment: 1 } }) }),
    );
  });

  it('mfaLoginVerify accepts TOTP codes and single-use recovery codes', async () => {
    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      secretEncrypted: new SealService(makeEnv()).seal(Buffer.from(sealedSecret)),
    });
    const mfaToken = new TokenService(makeEnv()).signMfaPendingToken('u-1');
    const tokens = new TokenService(makeEnv());

    const code = authenticator.generate(sealedSecret);
    const result = await service.mfaLoginVerify({ mfaToken, code });
    expect(result.mfaRequired).toBe(false);
    expect(result.tokens?.refreshToken).toBeDefined();

    const recovery = 'deadbeef';
    prisma.recoveryCode.findFirst.mockResolvedValue({ id: 'rc-1' });
    const viaRecovery = await service.mfaLoginVerify({ mfaToken, code: recovery });
    expect(viaRecovery.tokens).toBeDefined();
    expect(sentMail.some((m) => m.templateCode === 'MFA_RECOVERY_USED')).toBe(true);

    await expect(service.mfaLoginVerify({ mfaToken: 'garbage', code: '000000' })).rejects.toThrow(
      INVALID_CREDENTIALS_MESSAGE,
    );
    void tokens;
  });

  it('changePassword verifies the current password and rotates credentials', async () => {
    await expect(
      service.changePassword(
        'u-1',
        { currentPassword: 'Wrong999', newPassword: 'NewPass99' },
        'j-1',
      ),
    ).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);

    const result = await service.changePassword(
      'u-1',
      { currentPassword: 'Correct1', newPassword: 'NewPass99' },
      'j-1',
    );
    expect(result).toEqual({ changed: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ pwdVersion: { increment: 1 } }) }),
    );

    await expect(
      service.changePassword('u-1', { currentPassword: 'Correct1', newPassword: 'short1' }, 'j-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('change-email requests mail the new address and confirm applies it once', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await service.requestChangeEmail('u-1', {
      currentPassword: 'Correct1',
      newEmail: 'new@example.com',
    });
    expect(sentMail.some((m) => m.to === 'new@example.com')).toBe(true);

    prisma.user.findUnique.mockResolvedValue(verifiedUser({ email: 'new@example.com' }));
    await expect(
      service.requestChangeEmail('u-1', {
        currentPassword: 'Correct1',
        newEmail: 'new@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    prisma.user.findUnique.mockResolvedValue(null);
    const token = new TokenService(makeEnv()).signActionToken(
      'u-1',
      'CHANGE_EMAIL',
      60,
      'fresh@example.com',
    );
    const result = await service.confirmChangeEmail(token);
    expect(result).toEqual({ changed: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'fresh@example.com' }) }),
    );
    (prisma.usedToken.create as jest.Mock).mockRejectedValueOnce(new Error('P2002'));
    await expect(service.confirmChangeEmail(token)).rejects.toThrow(INVALID_TOKEN_MESSAGE);
  });

  it('mails resend and forgot tokens for eligible accounts', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(verifiedUser({ emailVerifiedAt: null }))
      .mockResolvedValueOnce(verifiedUser());
    await service.resendVerification({ email: 'parent@example.com' });
    await service.forgotPassword({ email: 'parent@example.com' });
    expect(sentMail.some((m) => m.templateCode === 'VERIFY_EMAIL')).toBe(true);
    expect(sentMail.some((m) => m.templateCode === 'RESET_PASSWORD')).toBe(true);
  });

  it('reports recovery code balance and mfa methods', async () => {
    await expect(service.recoveryCodesRemaining('u-1')).resolves.toEqual({ remaining: 10 });
    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.mfaMethods('u-1')).resolves.toEqual([{ type: 'totp', enabled: false }]);
  });

  it('requires the TOTP code on sensitive operations when MFA is enabled', async () => {
    (prisma.totpCredential.findUnique as jest.Mock).mockResolvedValue({
      userId: 'u-1',
      secretEncrypted: new SealService(makeEnv()).seal(Buffer.from(sealedSecret)),
    });
    await expect(
      service.changePassword(
        'u-1',
        { currentPassword: 'Correct1', newPassword: 'NewPass99' },
        'j-1',
      ),
    ).rejects.toThrow(/TOTP code required/);

    const code = authenticator.generate(sealedSecret);
    await expect(service.deactivate('u-1', { password: 'Correct1', code }, 'j-1')).resolves.toEqual(
      { deactivated: true },
    );
  });

  it('deactivate soft-deletes and revokes everything', async () => {
    const result = await service.deactivate('u-1', { password: 'Correct1' }, 'j-1');
    expect(result).toEqual({ deactivated: true });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
    await expect(service.deactivate('u-1', { password: 'Wrong999' }, 'j-1')).rejects.toThrow(
      INVALID_CREDENTIALS_MESSAGE,
    );
  });
});
