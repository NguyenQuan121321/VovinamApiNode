import { AdminUsersController } from './admin-users.controller';

describe('AdminUsersController', () => {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    create: jest.fn().mockResolvedValue({ id: 'u-1' }),
    update: jest.fn().mockResolvedValue({ id: 'u-1' }),
    deactivate: jest.fn().mockResolvedValue({ deactivated: true }),
    listAuditLog: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const controller = new AdminUsersController(service as never);
  const admin = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates user management to the service', async () => {
    await controller.list({ page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith({ page: 1, limit: 20 });

    const createDto = {
      email: 'a@example.com',
      password: 'Str0ngPass',
      role: 'INSTRUCTOR' as const,
    };
    await controller.create(admin, createDto);
    expect(service.create).toHaveBeenCalledWith(admin, createDto);

    await controller.update(admin, 'u-1', { role: 'STUDENT' });
    expect(service.update).toHaveBeenCalledWith(admin, 'u-1', { role: 'STUDENT' });

    await controller.deactivate(admin, 'u-1');
    expect(service.deactivate).toHaveBeenCalledWith(admin, 'u-1');
  });

  it('delegates the system-wide audit log query', async () => {
    await controller.auditLog({ page: 2, limit: 50, event: 'login' });
    expect(service.listAuditLog).toHaveBeenCalledWith({ page: 2, limit: 50, event: 'login' });
  });
});
