import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from './authenticated-request';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined || required.length === 0) {
      return true;
    }
    const user: AuthenticatedUser | undefined = context.switchToHttp().getRequest().user;
    if (user === undefined) {
      throw new UnauthorizedException('Unauthorized');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException('Forbidden');
    }
    // ADMIN MFA enforcement (plan 4.1): an ADMIN token only works on routes that
    // admit ADMIN once TOTP is enrolled. Routes without @Roles (self-scoped auth,
    // MFA management) stay reachable so the account can bootstrap enrollment.
    if (user.role === 'ADMIN' && required.includes('ADMIN')) {
      const credential = await this.prisma.totpCredential.findUnique({
        where: { userId: user.id },
        select: { userId: true },
      });
      if (credential === null) {
        throw new ForbiddenException('MFA enrollment required');
      }
    }
    return true;
  }
}
