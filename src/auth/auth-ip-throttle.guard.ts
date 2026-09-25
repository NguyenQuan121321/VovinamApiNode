import { Injectable, Inject, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import { SHARED_STORE, type SharedStore } from '../common/shared-store';
import { trackerFromRequest } from '../common/ip-tracker';
import { EnvService } from '../config/env.service';

/**
 * Strict fixed-window per-IP limiter for the /auth surface (register, login,
 * refresh, verification mail, reset, MFA). The global throttle (RATE_LIMIT_*)
 * covers the whole API; this second tier closes the abuse windows that only
 * need a handful of requests to matter: credential stuffing, mail bombing via
 * resend/forgot, and verification-token guessing.
 *
 * Counters live in the SharedStore — the same primitive as lockout and mail
 * budgets (plan 4.1) — and key on the hardened per-IP tracker (IPv6 /64
 * buckets, S-10). Fixed-window semantics match the mail budgets: the counter
 * survives for one window from the first request, then resets.
 */
/** The two limits the guard reads; narrow for testability (EnvService satisfies it). */
export type AuthIpLimitEnv = Pick<EnvService, 'authIpLimitMax' | 'authIpLimitTtlSeconds'>;

@Injectable()
export class AuthIpThrottleGuard implements CanActivate {
  constructor(
    @Inject(SHARED_STORE) private readonly store: SharedStore,
    // Explicit token: the narrow Pick alias emits no usable design:paramtypes metadata.
    @Inject(EnvService) private readonly env: AuthIpLimitEnv,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const tracker = trackerFromRequest(request);
    const count = this.store.increment(`auth-ip:${tracker}`, this.env.authIpLimitTtlSeconds * 1000);
    if (count > this.env.authIpLimitMax) {
      throw new HttpException('Too many requests', 429);
    }
    return true;
  }
}
