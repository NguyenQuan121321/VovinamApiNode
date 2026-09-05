import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Logger } from 'pino';
import bcrypt from 'bcryptjs';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnvService } from '../config/env.service';
import { APP_LOGGER } from '../logging/pino-logger.factory';
import { parseDurationSeconds } from '../common/duration';
import { SHARED_STORE, type SharedStore } from '../common/shared-store';
import { AuditService } from './audit/audit.service';
import type { MailPort } from './mail/mail.port';
import { MAIL_PORT } from './mail/mail.port';
import { validatePasswordPolicy } from './domain/password-policy';
import { RefreshTokenService } from './domain/refresh-token.service';
import { sha256Hex, TokenService, type ActionPurpose } from './domain/token.service';
import { SealService } from './mfa/seal.service';
import { generateRecoveryCodes, TotpService, type TotpEnrollment } from './mfa/totp.service';
import type {
  ChangeEmailRequestDto,
  ChangePasswordDto,
  SensitiveOperationDto,
} from './dto/account.dto';
import type { MfaLoginVerifyDto, TotpDisableDto } from './dto/mfa.dto';
import type {
  EmailOnlyDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

const BCRYPT_COST = 10;
/**
 * Fixed bcrypt hash used when the account does not exist so that wrong-password and
 * unknown-user logins take the same time (anti-enumeration, plan 4.1 / S-09).
 */
const DUMMY_BCRYPT_HASH = '$2b$10$NhGOVd9LBjmyZWLYA9Lg7.uHTwsOtrAbH.64DYbRgVKWS5MuWl9ii'; // nosemgrep: generic.secrets.security.detected-bcrypt-hash
const VERIFY_EMAIL_TTL_SECONDS = 86_400;
const RESET_PASSWORD_TTL_SECONDS = 900;
const USED_TOKEN_RETENTION_MS = 7 * 86_400_000;
const NEW_IP_WINDOW_DAYS = 30;
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
export const INVALID_TOKEN_MESSAGE = 'Invalid or expired token';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface LoginResult {
  mfaRequired: boolean;
  mfaToken?: string;
  tokens?: SessionTokens;
  user: PublicUser;
}

export interface PublicUser {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  createdAt: Date;
}

@Injectable()
export class AuthService {
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly audit: AuditService,
    private readonly seal: SealService,
    private readonly totp: TotpService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(SHARED_STORE) private readonly store: SharedStore,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {
    this.refreshTtlSeconds = parseDurationSeconds(env.refreshTokenTtl);
  }

  // ── Registration and single-use token flows ─────────────────────────────────

  async register(
    dto: RegisterDto,
    ip?: string,
  ): Promise<{ email: string; requiresVerification: boolean }> {
    if (!validatePasswordPolicy(dto.password, [dto.email, dto.email.split('@')[0] ?? ''])) {
      throw new BadRequestException(
        'Password must be at least 8 characters, contain letters and digits, and not include your email',
      );
    }
    if (dto.role === 'STUDENT' && yearsFrom(new Date(dto.dateOfBirth)) < 18) {
      // Minors never self-register (plan 7.1 / S-06): a parent registers and links them.
      throw new BadRequestException('Students under 18 must be registered by a parent or guardian');
    }
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing !== null) {
      // Anti-enumeration: identical response either way; the existing account is notified.
      this.audit.record({ event: 'register_duplicate', success: true, ip });
      await this.notify(
        dto.email,
        'REGISTER_DUPLICATE',
        'Registration attempt for an existing account',
        'Someone tried to register with this email. If this was you, use password recovery instead.',
      );
      return { email: dto.email, requiresVerification: true };
    }
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST),
        role: dto.role,
      },
    });
    const token = this.tokens.signActionToken(user.id, 'VERIFY_EMAIL', VERIFY_EMAIL_TTL_SECONDS);
    await this.notify(
      user.email,
      'VERIFY_EMAIL',
      'Verify your email',
      `Use this token to verify your email (valid 24 hours): ${token}`,
    );
    this.audit.record({ userId: user.id, event: 'register', success: true, ip });
    return { email: user.email, requiresVerification: true };
  }

  async verifyEmail(dto: VerifyEmailDto, ip?: string): Promise<{ emailVerified: boolean }> {
    const { userId, jti } = this.parseActionToken(dto.token, 'VERIFY_EMAIL');
    try {
      await this.prisma.$transaction([
        this.prisma.usedToken.create({
          data: {
            jti,
            userId,
            purpose: 'VERIFY_EMAIL',
            expiresAt: new Date(Date.now() + USED_TOKEN_RETENTION_MS),
          },
        }),
        this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } }),
      ]);
    } catch {
      // Replay of a consumed token hits the used_tokens unique constraint.
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }
    this.audit.record({ userId, event: 'email_verified', success: true, ip });
    return { emailVerified: true };
  }

  /** Uniform response regardless of account existence (anti-enumeration). */
  async resendVerification(dto: EmailOnlyDto, ip?: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (
      user !== null &&
      user.deletedAt === null &&
      user.isActive &&
      user.emailVerifiedAt === null
    ) {
      const token = this.tokens.signActionToken(user.id, 'VERIFY_EMAIL', VERIFY_EMAIL_TTL_SECONDS);
      await this.notify(
        user.email,
        'VERIFY_EMAIL',
        'Verify your email',
        `Use this token to verify your email (valid 24 hours): ${token}`,
      );
      this.audit.record({ userId: user.id, event: 'email_verification_resent', success: true, ip });
    }
    return { sent: true };
  }

  async forgotPassword(dto: EmailOnlyDto, ip?: string): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (user !== null && user.deletedAt === null && user.isActive) {
      const token = this.tokens.signActionToken(
        user.id,
        'RESET_PASSWORD',
        RESET_PASSWORD_TTL_SECONDS,
      );
      await this.notify(
        user.email,
        'RESET_PASSWORD',
        'Password recovery',
        `Use this token to reset your password (valid 15 minutes): ${token}`,
      );
      this.audit.record({ userId: user.id, event: 'password_reset_requested', success: true, ip });
    }
    return { sent: true };
  }

  async resetPassword(dto: ResetPasswordDto, ip?: string): Promise<{ reset: boolean }> {
    if (!validatePasswordPolicy(dto.password, [])) {
      throw new BadRequestException(
        'Password must be at least 8 characters and contain letters and digits',
      );
    }
    const { userId, jti } = this.parseActionToken(dto.token, 'RESET_PASSWORD');
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    try {
      await this.prisma.$transaction([
        this.prisma.usedToken.create({
          data: {
            jti,
            userId,
            purpose: 'RESET_PASSWORD',
            expiresAt: new Date(Date.now() + USED_TOKEN_RETENTION_MS),
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { passwordHash, pwdVersion: { increment: 1 } },
        }),
        this.prisma.session.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        }),
        this.prisma.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        }),
      ]);
    } catch {
      // Replay of a consumed token hits the used_tokens unique constraint.
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }
    this.audit.record({ userId, event: 'password_reset', success: true, ip });
    return { reset: true };
  }

  // ── Login / refresh / logout ─────────────────────────────────────────────────

  async login(dto: LoginDto, ip?: string, userAgent?: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (user === null) {
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      this.audit.record({ event: 'login_failed', success: false, ip, detail: 'unknown account' });
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) {
      await this.registerFailedAttempt(user, ip);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (user.deletedAt !== null || !user.isActive) {
      await this.notify(
        user.email,
        'LOGIN_BLOCKED_DISABLED',
        'Sign-in attempt on a disabled account',
        'A correct password was used for an account that is no longer active. No action is needed if this was you.',
      );
      this.audit.record({
        userId: user.id,
        event: 'login_failed',
        success: false,
        ip,
        detail: 'disabled',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (user.lockedUntil !== null && user.lockedUntil > new Date()) {
      await this.notify(
        user.email,
        'LOGIN_BLOCKED_LOCKED',
        'Sign-in attempt on a temporarily locked account',
        'Your account is temporarily locked after repeated failed sign-ins. Try again later.',
      );
      this.audit.record({ userId: user.id, event: 'login_locked', success: false, ip });
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (user.emailVerifiedAt === null) {
      await this.notify(
        user.email,
        'LOGIN_BLOCKED_UNVERIFIED',
        'Verify your email to sign in',
        'A sign-in was attempted before the email address was verified. Check your inbox for the verification token.',
      );
      this.audit.record({
        userId: user.id,
        event: 'login_failed',
        success: false,
        ip,
        detail: 'unverified',
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const mfaEnabled =
      (await this.prisma.totpCredential.findUnique({ where: { userId: user.id } })) !== null;
    if (mfaEnabled) {
      this.audit.record({
        userId: user.id,
        event: 'login',
        success: true,
        ip,
        detail: 'mfa_pending',
      });
      return {
        mfaRequired: true,
        mfaToken: this.tokens.signMfaPendingToken(user.id),
        user: toPublicUser(user, true),
      };
    }
    const tokens = await this.issueSession(user.id, ip, userAgent);
    await this.alertOnNewIp(user, ip);
    this.audit.record({ userId: user.id, event: 'login', success: true, ip });
    return { mfaRequired: false, tokens, user: toPublicUser(user, false) };
  }

  /** Issues a session plus access/refresh pair. Caller must have fully authenticated the user. */
  async issueSession(userId: string, ip?: string, userAgent?: string): Promise<SessionTokens> {
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);
    const refreshToken = this.refreshTokens.generate();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.session.create({ data: { userId, ip, userAgent, expiresAt } });
      await tx.refreshToken.create({
        data: {
          userId,
          sessionId: created.id,
          tokenHash: this.refreshTokens.hash(refreshToken),
          expiresAt,
        },
      });
      return created;
    });
    return {
      accessToken: this.tokens.signAccessToken(user, session.id),
      refreshToken,
      sessionId: session.id,
    };
  }

  /**
   * Rotation with reuse detection (plan 5.1 / S-08): replaying a consumed token (or
   * losing the atomic revoke race) revokes EVERY session of the user and raises an
   * out-of-band alert.
   */
  async refresh(refreshToken: string, ip?: string): Promise<SessionTokens> {
    const tokenHash = this.refreshTokens.hash(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (row === null) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const user = row.user;
    if (row.revoked) {
      await this.revokeEverythingForUser(user.id, ip);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (row.expiresAt <= new Date()) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    // Atomic single-consumption: only one concurrent caller wins the revoke.
    const consumed = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revoked: false },
      data: { revoked: true },
    });
    if (consumed.count === 0) {
      await this.revokeEverythingForUser(user.id, ip);
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    if (user.deletedAt !== null || !user.isActive || user.emailVerifiedAt === null) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: row.sessionId } });
    if (session.revoked) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const nextExpiresAt =
      session.expiresAt <= new Date()
        ? session.expiresAt
        : new Date(Date.now() + this.refreshTtlSeconds * 1000);
    const nextRefresh = this.refreshTokens.generate();
    await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          sessionId: row.sessionId,
          tokenHash: this.refreshTokens.hash(nextRefresh),
          expiresAt: nextExpiresAt,
        },
      }),
      this.prisma.session.update({
        where: { id: row.sessionId },
        data: { lastActiveAt: new Date() },
      }),
    ]);
    return {
      accessToken: this.tokens.signAccessToken(user, row.sessionId),
      refreshToken: nextRefresh,
      sessionId: row.sessionId,
    };
  }

  async logout(
    accessToken: string,
    jti: string,
    sessionId: string,
    ip?: string,
  ): Promise<{ loggedOut: boolean }> {
    const ttlMs = Math.max(1_000, this.tokens.remainingLifetimeSeconds(accessToken) * 1000);
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revoked: false },
        data: { revoked: true },
      }),
    ]);
    this.store.set(`jti:denylist:${jti}`, true, ttlMs);
    this.audit.record({ event: 'logout', success: true, ip });
    return { loggedOut: true };
  }

  async logoutAll(
    userId: string,
    currentJti: string,
    ip?: string,
  ): Promise<{ loggedOut: boolean }> {
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      // pwd_version bump instantly kills every remaining access token (plan 4.1).
      this.prisma.user.update({ where: { id: userId }, data: { pwdVersion: { increment: 1 } } }),
    ]);
    this.store.set(`jti:denylist:${currentJti}`, true, this.tokens.accessTtlMs);
    this.audit.record({ userId, event: 'logout_all', success: true, ip });
    return { loggedOut: true };
  }

  async listSessions(userId: string): Promise<Array<Record<string, unknown>>> {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revoked: false, expiresAt: { gt: new Date() } },
      orderBy: { lastActiveAt: 'desc' },
    });
    return sessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      deviceName: s.deviceName,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
    }));
  }

  async revokeSession(userId: string, sessionId: string, ip?: string): Promise<void> {
    const updated = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revoked: false },
      data: { revoked: true },
    });
    if (updated.count === 0) {
      // Uniform 401: no existence disclosure for foreign or already-revoked sessions.
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    await this.prisma.refreshToken.updateMany({
      where: { sessionId, revoked: false },
      data: { revoked: true },
    });
    this.audit.record({ userId, event: 'session_revoked', success: true, ip, detail: sessionId });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const mfaEnabled =
      (await this.prisma.totpCredential.findUnique({ where: { userId } })) !== null;
    return toPublicUser(user, mfaEnabled);
  }

  async auditLog(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditLog.count({ where: { userId } }),
    ]);
    return {
      items: items.map((entry) => ({
        id: entry.id,
        event: entry.event,
        ip: entry.ip,
        success: entry.success,
        detail: entry.detail,
        createdAt: entry.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  // ── MFA (TOTP + recovery codes) ─────────────────────────────────────────────

  async totpEnable(userId: string): Promise<Omit<TotpEnrollment, 'secret'>> {
    const existing = await this.prisma.totpCredential.findUnique({ where: { userId } });
    if (existing !== null) {
      throw new ConflictException('MFA is already enabled');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const enrollment = await this.totp.createEnrollment(user.email);
    this.totp.stashPendingSecret(userId, enrollment.secret);
    return { otpauthUrl: enrollment.otpauthUrl, qrDataUrl: enrollment.qrDataUrl };
  }

  async totpVerify(
    userId: string,
    code: string,
    ip?: string,
  ): Promise<{ recoveryCodes: string[] }> {
    const secret = this.totp.takePendingSecret(userId);
    if (secret === undefined) {
      throw new BadRequestException('No pending MFA enrollment');
    }
    if (!this.totp.verifyCode(userId, secret, code)) {
      throw new UnauthorizedException('Invalid verification code');
    }
    const codes = generateRecoveryCodes(10);
    await this.prisma.$transaction([
      this.prisma.totpCredential.create({
        data: {
          userId,
          secretEncrypted: this.seal.seal(Buffer.from(secret)),
          enabledAt: new Date(),
        },
      }),
      ...codes.map((code) =>
        this.prisma.recoveryCode.create({ data: { userId, codeHash: sha256Hex(code) } }),
      ),
    ]);
    this.audit.record({ userId, event: 'mfa_enabled', success: true, ip });
    return { recoveryCodes: codes };
  }

  async totpValidate(userId: string, code: string): Promise<{ valid: boolean }> {
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId } });
    if (credential === null) {
      throw new BadRequestException('MFA is not enabled');
    }
    const secret = this.seal.unseal(credential.secretEncrypted).toString();
    if (!this.totp.validateCode(userId, secret, code)) {
      throw new UnauthorizedException('Invalid verification code');
    }
    return { valid: true };
  }

  async totpDisable(
    userId: string,
    dto: TotpDisableDto,
    ip?: string,
  ): Promise<{ disabled: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.verifySensitiveCredentials(user, dto.password, dto.code);
    await this.prisma.$transaction([
      this.prisma.totpCredential.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.session.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.user.update({ where: { id: userId }, data: { pwdVersion: { increment: 1 } } }),
    ]);
    this.audit.record({ userId, event: 'mfa_disabled', success: true, ip });
    return { disabled: true };
  }

  async recoveryCodesRemaining(userId: string): Promise<{ remaining: number }> {
    const remaining = await this.prisma.recoveryCode.count({ where: { userId, usedAt: null } });
    return { remaining };
  }

  async mfaMethods(userId: string): Promise<Array<{ type: string; enabled: boolean }>> {
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId } });
    return [{ type: 'totp', enabled: credential !== null }];
  }

  /** Second login leg when TOTP is enabled: mfa_pending token + TOTP or recovery code. */
  async mfaLoginVerify(
    dto: MfaLoginVerifyDto,
    ip?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    let userId: string;
    try {
      const claims = this.tokens.verify(dto.mfaToken, 'mfa_pending');
      if (typeof claims.sub !== 'string') {
        throw new Error('bad claims');
      }
      userId = claims.sub;
    } catch {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    this.totp.assertNotLocked(userId);
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId } });
    if (credential === null) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const secret = this.seal.unseal(credential.secretEncrypted).toString();
    const totpOk = this.totp.verifyCode(userId, secret, dto.code);
    let usedRecoveryCode = false;
    if (!totpOk && dto.code.length === 8) {
      const codeHash = sha256Hex(dto.code);
      const row = await this.prisma.recoveryCode.findFirst({
        where: { userId, codeHash, usedAt: null },
      });
      if (row !== null) {
        await this.prisma.recoveryCode.update({
          where: { id: row.id },
          data: { usedAt: new Date() },
        });
        usedRecoveryCode = true;
      }
    }
    if (!totpOk && !usedRecoveryCode) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.deletedAt !== null || !user.isActive) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const tokens = await this.issueSession(user.id, ip, userAgent);
    await this.alertOnNewIp(user, ip);
    this.audit.record({
      userId,
      event: 'login',
      success: true,
      ip,
      detail: usedRecoveryCode ? 'mfa_recovery_used' : 'mfa',
    });
    if (usedRecoveryCode) {
      this.audit.record({ userId, event: 'mfa_recovery_used', success: true, ip });
      await this.notify(
        user.email,
        'MFA_RECOVERY_USED',
        'A recovery code was used to sign in',
        'A single-use recovery code was used to sign in to your account. If this was not you, reset your password immediately.',
      );
    }
    return { mfaRequired: false, tokens, user: toPublicUser(user, true) };
  }

  // ── Account lifecycle ───────────────────────────────────────────────────────

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    currentJti: string,
    ip?: string,
  ): Promise<{ changed: boolean }> {
    if (!validatePasswordPolicy(dto.newPassword, [])) {
      throw new BadRequestException(
        'Password must be at least 8 characters and contain letters and digits',
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.verifySensitiveCredentials(user, dto.currentPassword, dto.code);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash: await bcrypt.hash(dto.newPassword, BCRYPT_COST),
          pwdVersion: { increment: 1 },
        },
      }),
      this.prisma.session.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
    ]);
    this.store.set(`jti:denylist:${currentJti}`, true, this.tokens.accessTtlMs);
    this.audit.record({ userId, event: 'password_changed', success: true, ip });
    return { changed: true };
  }

  async requestChangeEmail(
    userId: string,
    dto: ChangeEmailRequestDto,
    ip?: string,
  ): Promise<{ sent: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.verifySensitiveCredentials(user, dto.currentPassword);
    const taken = await this.prisma.user.findUnique({ where: { email: dto.newEmail } });
    if (taken !== null) {
      throw new ConflictException('Email already in use');
    }
    const token = this.tokens.signActionToken(
      userId,
      'CHANGE_EMAIL',
      VERIFY_EMAIL_TTL_SECONDS,
      dto.newEmail,
    );
    await this.notify(
      dto.newEmail,
      'CHANGE_EMAIL',
      'Confirm your new email address',
      `Use this token to confirm the email change (valid 24 hours): ${token}`,
    );
    this.audit.record({ userId, event: 'email_change_requested', success: true, ip });
    return { sent: true };
  }

  async confirmChangeEmail(token: string, ip?: string): Promise<{ changed: boolean }> {
    const { userId, jti, target } = this.parseActionToken(token, 'CHANGE_EMAIL');
    if (target === undefined) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }
    const taken = await this.prisma.user.findUnique({ where: { email: target } });
    if (taken !== null) {
      throw new ConflictException('Email already in use');
    }
    try {
      await this.prisma.$transaction([
        this.prisma.usedToken.create({
          data: {
            jti,
            userId,
            purpose: 'CHANGE_EMAIL',
            expiresAt: new Date(Date.now() + USED_TOKEN_RETENTION_MS),
          },
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { email: target, emailVerifiedAt: new Date(), pwdVersion: { increment: 1 } },
        }),
        this.prisma.session.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        }),
        this.prisma.refreshToken.updateMany({
          where: { userId, revoked: false },
          data: { revoked: true },
        }),
      ]);
    } catch {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }
    this.audit.record({ userId, event: 'email_changed', success: true, ip, detail: target });
    return { changed: true };
  }

  async deactivate(
    userId: string,
    dto: SensitiveOperationDto,
    currentJti: string,
    ip?: string,
  ): Promise<{ deactivated: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.verifySensitiveCredentials(user, dto.password, dto.code);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { deletedAt: new Date(), isActive: false },
      }),
      this.prisma.session.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
    ]);
    this.store.set(`jti:denylist:${currentJti}`, true, this.tokens.accessTtlMs);
    this.audit.record({ userId, event: 'account_deactivated', success: true, ip });
    return { deactivated: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async registerFailedAttempt(user: User, ip?: string): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= this.env.maxLoginAttempts;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: shouldLock ? 0 : attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + parseDurationSeconds(this.env.loginLockoutDuration) * 1000)
          : null,
      },
    });
    if (shouldLock) {
      this.audit.record({ userId: user.id, event: 'account_locked', success: false, ip });
      await this.notify(
        user.email,
        'ACCOUNT_LOCKED',
        'Account temporarily locked',
        'Too many failed sign-ins locked your account temporarily.',
      );
    }
    this.audit.record({ userId: user.id, event: 'login_failed', success: false, ip });
  }

  private async alertOnNewIp(user: User, ip?: string): Promise<void> {
    if (ip === undefined || ip === '') {
      return;
    }
    const since = new Date(Date.now() - NEW_IP_WINDOW_DAYS * 86_400_000);
    const known = await this.prisma.auditLog.count({
      where: { userId: user.id, event: 'login', success: true, ip, createdAt: { gte: since } },
    });
    if (known === 0) {
      await this.notify(
        user.email,
        'LOGIN_NEW_IP',
        'New location sign-in',
        `A sign-in to your account was recorded from a new IP address (${ip}). If this was not you, reset your password immediately.`,
      );
      this.audit.record({ userId: user.id, event: 'login_new_ip', success: true, ip });
    }
  }

  /** Signature/type/purpose check only; callers must consume the jti in used_tokens. */
  private parseActionToken(
    token: string,
    purpose: ActionPurpose,
  ): { userId: string; jti: string; target?: string } {
    let claims: { sub?: string; purpose?: ActionPurpose; jti?: string; target?: string };
    try {
      claims = this.tokens.verify(token, 'action') as typeof claims;
    } catch {
      // Signature, issuer, expiry or type mismatch: one uniform rejection (plan 9).
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }
    if (claims.sub === undefined || claims.jti === undefined || claims.purpose !== purpose) {
      throw new BadRequestException(INVALID_TOKEN_MESSAGE);
    }
    return { userId: claims.sub, jti: claims.jti, target: claims.target };
  }

  /** Inline confirmation for sensitive operations: password (+ TOTP when enrolled, plan 4.2). */
  private async verifySensitiveCredentials(
    user: User,
    password: string,
    code?: string,
  ): Promise<void> {
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const credential = await this.prisma.totpCredential.findUnique({ where: { userId: user.id } });
    if (credential !== null) {
      if (code === undefined) {
        throw new BadRequestException('TOTP code required');
      }
      const secret = this.seal.unseal(credential.secretEncrypted).toString();
      if (!this.totp.verifyCode(user.id, secret, code)) {
        throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
      }
    }
  }

  private async revokeEverythingForUser(userId: string, ip?: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      }),
    ]);
    this.audit.record({ userId, event: 'token_reuse_detected', success: false, ip });
    const user = (await this.prisma.user.findUnique({ where: { id: userId } })) ?? null;
    if (user !== null) {
      await this.notify(
        user.email,
        'TOKEN_REUSE',
        'Security alert: all sessions were signed out',
        'A refresh token was reused, which usually means a token was stolen. All sessions have been revoked.',
      );
    }
    this.logger.warn({ userId }, 'refresh_token_reuse_detected');
  }

  private async notify(
    to: string,
    templateCode: string,
    subject: string,
    body: string,
  ): Promise<void> {
    try {
      await this.mail.send({ to, templateCode, subject, body });
    } catch (error) {
      this.logger.warn(
        { templateCode, err: error instanceof Error ? error.message : 'unknown' },
        'mail_send_failed',
      );
    }
  }
}

export function toPublicUser(user: User, mfaEnabled: boolean): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    mfaEnabled,
    createdAt: user.createdAt,
  };
}

function yearsFrom(date: Date): number {
  const now = new Date();
  let age = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < date.getUTCDate())) {
    age -= 1;
  }
  return age;
}
