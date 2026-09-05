import { EnrollmentsController } from './enrollments.controller';

describe('EnrollmentsController', () => {
  const service = {
    create: jest.fn().mockResolvedValue({ id: 'e-1' }),
    list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    remove: jest.fn().mockResolvedValue({ left: true }),
  };
  const controller = new EnrollmentsController(service as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates enrollment management to the service', async () => {
    await controller.create({ studentId: 'sp-1', classId: 'class-1' });
    expect(service.create).toHaveBeenCalledWith({ studentId: 'sp-1', classId: 'class-1' });

    await controller.list({ page: 1, limit: 20, classId: 'class-1' });
    expect(service.list).toHaveBeenCalledWith({ page: 1, limit: 20, classId: 'class-1' });

    await expect(controller.remove('e-1')).resolves.toEqual({ left: true });
    expect(service.remove).toHaveBeenCalledWith('e-1');
  });
});
