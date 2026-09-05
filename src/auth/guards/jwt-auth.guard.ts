import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { SHARED_STORE, type SharedStore } from '../../common/shared-store';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../domain/token.service';
import type { AuthenticatedRequest, AuthenticatedUser } from './authenticated-request';

/**
 * Bearer-token guard (plan 4.1): verifies signature/type/issuer, rejects denylisted
 * jti (logout), stale pwd_version (credential changes), deactivated accounts and
 * revoked or expired sessions. Every failure is a uniform 401.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
    @Inject(SHARED_STORE) private readonly store: SharedStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Unauthorized');
    }
    let claims;
    try {
      claims = this.tokenService.verify(header.slice('Bearer '.length), 'access');
    } catch {
      throw new UnauthorizedException('Unauthorized');
    }
    const { sub, jti, sid, pwdver } = claims;
    if (typeof sub !== 'string' || typeof jti !== 'string' || typeof sid !== 'string') {
      throw new UnauthorizedException('Unauthorized');
    }
    if (this.store.get(`jti:denylist:${jti}`) !== undefined) {
      throw new UnauthorizedException('Unauthorized');
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (user === null || user.deletedAt !== null || !user.isActive || user.pwdVersion !== pwdver) {
      throw new UnauthorizedException('Unauthorized');
    }
    const session = await this.prisma.session.findUnique({ where: { id: sid } });
    if (session === null || session.revoked || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Unauthorized');
    }
    (request as AuthenticatedRequest).user = {
      id: user.id,
      role: user.role,
      sessionId: sid,
      jti,
    } satisfies AuthenticatedUser;
    return true;
  }
}
