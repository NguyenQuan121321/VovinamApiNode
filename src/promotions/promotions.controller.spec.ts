import { PromotionsController } from './promotions.controller';

describe('PromotionsController', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'p-1' }),
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    updateNote: jest.fn().mockResolvedValue({ id: 'p-1' }),
    review: jest.fn().mockResolvedValue({ id: 'p-1', status: 'APPROVED' }),
  };
  const controller = new PromotionsController(service as never);
  const caller = { id: 'u-1', role: 'INSTRUCTOR', sessionId: 's', jti: 'j' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates the proposal lifecycle to the service', async () => {
    const dto = { studentId: 'sp-1', proposedRankId: 4 };
    await controller.create(caller, dto);
    expect(service.create).toHaveBeenCalledWith(caller, dto);

    await controller.list(caller, { page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith(caller, { page: 1, limit: 20 });

    await controller.updateNote(caller, 'p-1', { note: 'Ready' });
    expect(service.updateNote).toHaveBeenCalledWith(caller, 'p-1', { note: 'Ready' });

    await controller.review(caller, 'p-1', { status: 'APPROVED' });
    expect(service.review).toHaveBeenCalledWith(caller, 'p-1', { status: 'APPROVED' });
  });
});
