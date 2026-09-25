import { LeavesController } from './leaves.controller';

describe('LeavesController', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'lr-1' }),
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    review: jest.fn().mockResolvedValue({ id: 'lr-1', status: 'APPROVED' }),
    cancel: jest.fn().mockResolvedValue({ id: 'lr-1', status: 'CANCELLED' }),
    delete: jest.fn().mockResolvedValue({ deleted: true }),
  };
  const controller = new LeavesController(service as never);
  const caller = { id: 'u-1', role: 'STUDENT', sessionId: 's', jti: 'j' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates the leave-request lifecycle to the service', async () => {
    const dto = { studentId: 'sp-1', classId: 'c-1', sessionDate: '2026-10-01', reason: 'X' };
    await controller.create(caller, dto);
    expect(service.create).toHaveBeenCalledWith(caller, dto);

    await controller.list(caller, { page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith(caller, { page: 1, limit: 20 });

    await controller.review(caller, 'lr-1', { status: 'APPROVED' });
    expect(service.review).toHaveBeenCalledWith(caller, 'lr-1', { status: 'APPROVED' });

    await controller.cancel(caller, 'lr-1');
    expect(service.cancel).toHaveBeenCalledWith(caller, 'lr-1');

    await controller.delete(caller, 'lr-1');
    expect(service.delete).toHaveBeenCalledWith(caller, 'lr-1');
  });
});
