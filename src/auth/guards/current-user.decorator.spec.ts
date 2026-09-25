import { currentUserFactory } from './current-user.decorator';

describe('CurrentUser decorator factory', () => {
  const context = (user?: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  it('returns the authenticated user from the request', () => {
    const user = { id: 'u-1', role: 'STUDENT', jti: 'j', sessionId: 's' };
    expect(currentUserFactory(undefined, context(user))).toBe(user);
  });

  it('fails loudly when used outside an authenticated request', () => {
    expect(() => currentUserFactory(undefined, context(undefined))).toThrow(
      /outside an authenticated request/,
    );
  });
});
