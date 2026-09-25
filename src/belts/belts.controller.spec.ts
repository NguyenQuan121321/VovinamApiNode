import { BeltReportsController, BeltsController } from './belts.controller';

describe('BeltsController', () => {
  const service = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 1 }),
    update: jest.fn().mockResolvedValue({ id: 1 }),
    distribution: jest.fn().mockResolvedValue({ distribution: [] }),
  };
  const controller = new BeltsController(service as never);
  const reports = new BeltReportsController(service as never);
  const caller = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the rank catalog and delegates admin writes', async () => {
    await controller.list();
    expect(service.list).toHaveBeenCalled();

    await controller.create({
      code: 'VANG_1',
      name: 'Yellow Belt I',
      rankGroup: 'VANG',
      orderIndex: 4,
    });
    expect(service.create).toHaveBeenCalledWith({
      code: 'VANG_1',
      name: 'Yellow Belt I',
      rankGroup: 'VANG',
      orderIndex: 4,
    });

    await controller.update('1', { name: 'Renamed' });
    expect(service.update).toHaveBeenCalledWith(1, { name: 'Renamed' });
  });

  it('delegates the belt distribution report with the caller for scoping', async () => {
    await reports.distribution(caller);
    expect(service.distribution).toHaveBeenCalledWith(caller);
  });
});
