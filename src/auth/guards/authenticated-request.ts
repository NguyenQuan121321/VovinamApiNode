import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  sessionId: string;
  jti: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}
