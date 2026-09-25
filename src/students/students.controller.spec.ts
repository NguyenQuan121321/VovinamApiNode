import { StudentsController } from './students.controller';

describe('StudentsController', () => {
  const service = {
    myProfile: jest.fn().mockResolvedValue({ id: 'sp-1' }),
    updateOwn: jest.fn().mockResolvedValue({ id: 'sp-1' }),
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    create: jest.fn().mockResolvedValue({ id: 'sp-1' }),
    getById: jest.fn().mockResolvedValue({ id: 'sp-1' }),
    update: jest.fn().mockResolvedValue({ id: 'sp-1' }),
    softDelete: jest.fn().mockResolvedValue({ deleted: true }),
    regenerateInviteCode: jest.fn().mockResolvedValue({ inviteCode: 'ABCD2345' }),
  };
  const controller = new StudentsController(service as never);
  const admin = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates every student operation to the service', async () => {
    await controller.me(admin);
    expect(service.myProfile).toHaveBeenCalledWith(admin);

    await controller.updateOwn(admin, { phone: '0901' });
    expect(service.updateOwn).toHaveBeenCalledWith(admin, { phone: '0901' });

    await controller.list(admin, { page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith(admin, { page: 1, limit: 20 });

    await controller.create({ fullName: 'X', dob: '2010-01-01', gender: 'MALE' });
    expect(service.create).toHaveBeenCalled();

    await controller.getById(admin, 'sp-1');
    expect(service.getById).toHaveBeenCalledWith(admin, 'sp-1');

    await controller.update('sp-1', { status: 'ACTIVE' });
    expect(service.update).toHaveBeenCalledWith('sp-1', { status: 'ACTIVE' });

    await controller.softDelete('sp-1');
    expect(service.softDelete).toHaveBeenCalledWith('sp-1');

    await controller.regenerateInviteCode('sp-1');
    expect(service.regenerateInviteCode).toHaveBeenCalledWith('sp-1');
  });
});
