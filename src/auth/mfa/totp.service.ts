import { randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { authenticator } from 'otplib';
import type { Logger } from 'pino';
import { toDataURL } from 'qrcode';
import { SHARED_STORE, type SharedStore } from '../../common/shared-store';
import { APP_LOGGER } from '../../logging/pino-logger.factory';

const FAILURE_BUCKET_TTL_MS = 5 * 60 * 1000;
const MAX_MFA_FAILURES = 5;
const REPLAY_GUARD_MS = 120_000;
const PENDING_SECRET_TTL_MS = 10 * 60_000;
/** ±1 full 30s time step on either side of the current one (plan 4.1). */
const SKEW_WINDOW_STEPS = 1;
const TOTP_ISSUER = 'VovinamApiNode';

const failKey = (userId: string): string => `mfa:fail:${userId}`;
const replayKey = (userId: string, token: string): string => `mfa:replay:${userId}:${token}`;
const pendingKey = (userId: string): string => `mfa:pending:${userId}`;

export interface TotpEnrollment {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

/**
 * TOTP with otplib (plan 4.1): ±1 step skew, a 120s replay guard, and ONE shared
 * failure bucket across verify/validate/login-verify — 5 failures in 5 minutes lock
 * all three paths (plan 12.1 S-05).
 */
@Injectable()
export class TotpService {
  /**
   * Dedicated instance with an explicit ±1 step window. create() resets plugin
   * options, so the singleton's current options must be spread in as the base.
   */
  private readonly totp = authenticator.create({
    ...authenticator.options,
    window: SKEW_WINDOW_STEPS,
  });

  constructor(
    @Inject(SHARED_STORE) private readonly store: SharedStore,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  async createEnrollment(label: string): Promise<TotpEnrollment> {
    const secret = this.totp.generateSecret();
    const otpauthUrl = this.totp.keyuri(label, TOTP_ISSUER, secret);
    const qrDataUrl = await toDataURL(otpauthUrl);
    return { secret, otpauthUrl, qrDataUrl };
  }

  stashPendingSecret(userId: string, secret: string): void {
    this.store.set(pendingKey(userId), secret, PENDING_SECRET_TTL_MS);
  }

  takePendingSecret(userId: string): string | undefined {
    const stored = this.store.get(pendingKey(userId));
    this.store.delete(pendingKey(userId));
    return typeof stored === 'string' ? stored : undefined;
  }

  assertNotLocked(userId: string): void {
    const failures = this.store.get(failKey(userId));
    if (typeof failures === 'number' && failures >= MAX_MFA_FAILURES) {
      throw new UnauthorizedException('Too many verification attempts');
    }
  }

  verifyCode(userId: string, secret: string, code: string, nowMs = Date.now()): boolean {
    this.assertNotLocked(userId);
    const normalized = code.trim();
    const replayed = this.store.get(replayKey(userId, normalized)) !== undefined;
    // Per-call instance: epoch must match the caller's clock (tests pin it to make
    // step-boundary races impossible); production uses the default wall clock.
    const verifier = authenticator.create({
      ...authenticator.options,
      window: SKEW_WINDOW_STEPS,
      epoch: nowMs,
    });
    const valid = !replayed && verifier.verify({ token: normalized, secret });
    if (valid) {
      this.store.delete(failKey(userId));
      this.store.set(replayKey(userId, normalized), true, REPLAY_GUARD_MS);
      return true;
    }
    this.registerFailure(userId);
    return false;
  }

  /** Validates without treating success as a login; used by POST mfa/totp/validate. */
  validateCode(userId: string, secret: string, code: string): boolean {
    return this.verifyCode(userId, secret, code);
  }

  private registerFailure(userId: string): void {
    const failures = this.store.increment(failKey(userId), FAILURE_BUCKET_TTL_MS);
    this.logger.warn({ userId, failures }, 'mfa_code_failed');
    if (failures >= MAX_MFA_FAILURES) {
      throw new UnauthorizedException('Too many verification attempts');
    }
  }
}

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(randomBytes(4).toString('hex'));
  }
  return codes;
}
