import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'vovinam:roles';

/** Static role restriction (plan 4.2): data-scoped access still goes through the ownership guard (plan 7.3). */
export function Roles(...roles: UserRole[]): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_KEY, roles);
}
