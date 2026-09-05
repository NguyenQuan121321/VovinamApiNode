import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from './authenticated-request';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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
    return true;
  }
}
