import { ClassesController } from './classes.controller';

describe('ClassesController', () => {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    getById: jest.fn().mockResolvedValue({ id: 'class-1' }),
    create: jest.fn().mockResolvedValue({ id: 'class-1' }),
    update: jest.fn().mockResolvedValue({ id: 'class-1' }),
    addSchedule: jest.fn().mockResolvedValue({ id: 'sched-1' }),
    removeSchedule: jest.fn().mockResolvedValue({ removed: true }),
  };
  const controller = new ClassesController(service as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates reads to the service', async () => {
    await controller.list({ page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith({ page: 1, limit: 20 });

    await controller.getById('class-1');
    expect(service.getById).toHaveBeenCalledWith('class-1');
  });

  it('delegates admin writes to the service', async () => {
    await controller.create({ name: 'White Belt A', instructorId: 'inst-1' });
    expect(service.create).toHaveBeenCalledWith({ name: 'White Belt A', instructorId: 'inst-1' });

    await controller.update('class-1', { name: 'Renamed' });
    expect(service.update).toHaveBeenCalledWith('class-1', { name: 'Renamed' });

    await controller.addSchedule('class-1', {
      weekday: 1,
      startTime: '18:00',
      endTime: '20:00',
      effectiveFrom: '2026-01-01',
    });
    expect(service.addSchedule).toHaveBeenCalledWith('class-1', {
      weekday: 1,
      startTime: '18:00',
      endTime: '20:00',
      effectiveFrom: '2026-01-01',
    });

    await expect(controller.removeSchedule('class-1', 'sched-1')).resolves.toEqual({
      removed: true,
    });
    expect(service.removeSchedule).toHaveBeenCalledWith('class-1', 'sched-1');
  });
});
