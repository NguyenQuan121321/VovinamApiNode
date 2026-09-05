import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { parseDurationSeconds } from '../../common/duration';
import { EnvService } from '../../config/env.service';

export interface AccessTokenClaims extends JwtPayload {
  sub: string;
  role: UserRole;
  type: 'access';
  jti: string;
  sid: string;
  pwdver: number;
}

export interface MfaPendingClaims extends JwtPayload {
  sub: string;
  type: 'mfa_pending';
  jti: string;
}

const CURRENT_KID = 'current';
const PREVIOUS_KID = 'previous';
const HS256 = 'HS256';

/**
 * HS256 access tokens with two-key rotation (plan 4.1): signing always uses
 * JWT_SECRET (kid "current"); verification accepts JWT_SECRET_PREVIOUS (kid
 * "previous") so a rotation does not log everyone out. pwd_version lets the
 * guard invalidate old access tokens instantly after credential changes.
 */
@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly mfaPendingTtlSeconds: number;

  constructor(private readonly env: EnvService) {
    this.accessTtlSeconds = parseDurationSeconds(env.accessTokenTtl);
    this.mfaPendingTtlSeconds = parseDurationSeconds('5m');
  }

  get accessTtlMs(): number {
    return this.accessTtlSeconds * 1000;
  }

  signAccessToken(user: { id: string; role: UserRole; pwdVersion: number }, sessionId: string): string {
    return jwt.sign(
      { role: user.role, type: 'access', jti: randomUUID(), sid: sessionId, pwdver: user.pwdVersion },
      this.env.jwtSecret,
      {
        algorithm: HS256,
        keyid: CURRENT_KID,
        subject: user.id,
        issuer: this.env.jwtIssuer,
        expiresIn: this.accessTtlSeconds,
      },
    );
  }

  signMfaPendingToken(userId: string): string {
    return jwt.sign({ type: 'mfa_pending', jti: randomUUID() }, this.env.jwtSecret, {
      algorithm: HS256,
      keyid: CURRENT_KID,
      subject: userId,
      issuer: this.env.jwtIssuer,
      expiresIn: this.mfaPendingTtlSeconds,
    });
  }

  verify(token: string, expectedType: 'access' | 'mfa_pending'): JwtPayload {
    const decoded = jwt.decode(token, { complete: true });
    if (decoded === null) {
      throw new jwt.JsonWebTokenError('invalid token');
    }
    const kid = decoded.header.kid ?? CURRENT_KID;
    const secret =
      kid === PREVIOUS_KID && this.env.jwtSecretPrevious !== undefined
        ? this.env.jwtSecretPrevious
        : this.env.jwtSecret;
    if (kid !== CURRENT_KID && kid !== PREVIOUS_KID) {
      throw new jwt.JsonWebTokenError('unknown key id');
    }
    const payload = jwt.verify(token, secret, {
      algorithms: [HS256],
      issuer: this.env.jwtIssuer,
    }) as JwtPayload;
    if (payload.type !== expectedType) {
      throw new jwt.JsonWebTokenError('unexpected token type');
    }
    return payload;
  }

  /** Seconds remaining before the token expires (for denylist TTLs). */
  remainingLifetimeSeconds(token: string): number {
    const decoded = jwt.decode(token, { complete: true });
    const exp = typeof decoded?.payload === 'object' ? decoded.payload.exp : undefined;
    if (decoded === null || typeof exp !== 'number') {
      return 0;
    }
    return Math.max(0, exp - Math.floor(Date.now() / 1000));
  }
}

/** SHA-256 helper shared by refresh/recovery hashing (plan 5.2: hashes at rest, never raw tokens). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
