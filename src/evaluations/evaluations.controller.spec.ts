import { EvaluationsController } from './evaluations.controller';

describe('EvaluationsController', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'ev-1' }),
    listForStudent: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    update: jest.fn().mockResolvedValue({ id: 'ev-1' }),
    delete: jest.fn().mockResolvedValue({ deleted: true }),
  };
  const controller = new EvaluationsController(service as never);
  const caller = { id: 'u-1', role: 'INSTRUCTOR', sessionId: 's', jti: 'j' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates evaluation writes and reads to the service', async () => {
    const dto = { studentId: 'sp-1', rating: 8, periodMonth: 9, periodYear: 2026 };
    await controller.create(caller, dto);
    expect(service.create).toHaveBeenCalledWith(caller, dto);

    const query = { page: 1, limit: 20, studentId: 'sp-1' };
    await controller.listForStudent(caller, query);
    expect(service.listForStudent).toHaveBeenCalledWith(caller, query);

    await controller.update(caller, 'ev-1', { rating: 9 });
    expect(service.update).toHaveBeenCalledWith(caller, 'ev-1', { rating: 9 });

    await controller.delete(caller, 'ev-1');
    expect(service.delete).toHaveBeenCalledWith(caller, 'ev-1');
  });
});
