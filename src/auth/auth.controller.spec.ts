import type { Request } from 'express';
import { AuthController } from './auth.controller';
import type { AuthenticatedRequest } from './guards/authenticated-request';

describe('AuthController', () => {
  const auth = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    logout: jest.fn(),
    logoutAll: jest.fn(),
    listSessions: jest.fn(),
    revokeSession: jest.fn(),
    me: jest.fn(),
    auditLog: jest.fn(),
  };
  const controller = new AuthController(auth as never);

  const req = {
    ip: '127.0.0.1',
    headers: { authorization: 'Bearer tok', 'user-agent': 'ua' },
  } as unknown as Request;
  const authedReq = {
    ...req,
    user: { id: 'u-1', role: 'PARENT', sessionId: 's-1', jti: 'j-1' },
  } as unknown as AuthenticatedRequest & Request;
  const dto = { email: 'a@b.co' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates public endpoints to the service with request metadata', async () => {
    await controller.register(dto as never, req);
    expect(auth.register).toHaveBeenCalledWith(dto, '127.0.0.1');

    await controller.login(dto as never, req);
    expect(auth.login).toHaveBeenCalledWith(dto, '127.0.0.1', 'ua');

    await controller.refreshToken({ refreshToken: 'r' }, req);
    expect(auth.refresh).toHaveBeenCalledWith('r', '127.0.0.1');

    await controller.verifyEmail({ token: 't' }, req);
    await controller.resendVerification(dto as never, req);
    await controller.forgotPassword(dto as never, req);
    await controller.resetPassword({ token: 't', password: 'p' } as never, req);
    expect(auth.verifyEmail).toHaveBeenCalled();
    expect(auth.resendVerification).toHaveBeenCalledWith(dto, '127.0.0.1');
    expect(auth.forgotPassword).toHaveBeenCalledWith(dto, '127.0.0.1');
    expect(auth.resetPassword).toHaveBeenCalledWith({ token: 't', password: 'p' }, '127.0.0.1');
  });

  it('passes the authenticated user into protected endpoints', async () => {
    await controller.logout(authedReq);
    expect(auth.logout).toHaveBeenCalledWith('tok', 'j-1', 's-1', '127.0.0.1');

    await controller.logoutAll(authedReq.user as never, req);
    expect(auth.logoutAll).toHaveBeenCalledWith('u-1', 'j-1', '127.0.0.1');

    await controller.sessions(authedReq.user as never);
    await controller.revokeSession(authedReq.user as never, 's-2', req);
    await controller.me(authedReq.user as never);
    await controller.auditLog(authedReq.user as never, { page: 2, limit: 5 });
    expect(auth.listSessions).toHaveBeenCalledWith('u-1');
    expect(auth.revokeSession).toHaveBeenCalledWith('u-1', 's-2', '127.0.0.1');
    expect(auth.me).toHaveBeenCalledWith('u-1');
    expect(auth.auditLog).toHaveBeenCalledWith('u-1', 2, 5);
  });

  it('revokeSession resolves with revoked true', async () => {
    auth.revokeSession.mockResolvedValue(undefined);
    await expect(controller.revokeSession(authedReq.user as never, 's-1', req)).resolves.toEqual({
      revoked: true,
    });
  });
});
