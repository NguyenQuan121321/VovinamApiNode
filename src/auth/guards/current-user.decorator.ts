import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, AuthenticatedUser } from './authenticated-request';

/**
 * Extracted so the fallback contract is unit-testable; Nest wraps it with
 * createParamDecorator below and invokes it with the execution context.
 */
export function currentUserFactory(_data: unknown, context: ExecutionContext): AuthenticatedUser {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (request.user === undefined) {
    throw new Error('CurrentUser used outside an authenticated request');
  }
  return request.user;
}

export const CurrentUser = createParamDecorator(currentUserFactory);
