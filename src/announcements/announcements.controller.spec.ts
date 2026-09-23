import { AnnouncementsController } from './announcements.controller';

describe('AnnouncementsController', () => {
  const service = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    create: jest.fn().mockResolvedValue({ id: 'a1' }),
    update: jest.fn().mockResolvedValue({ id: 'a1' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
  };
  const controller = new AnnouncementsController(service as never);
  const admin = { id: 'admin-1', role: 'ADMIN' as const, sessionId: 's', jti: 'j' };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates the audience-scoped feed and admin writes', async () => {
    await controller.list(admin, { page: 1, limit: 20 });
    expect(service.list).toHaveBeenCalledWith(admin, { page: 1, limit: 20 });

    await controller.create(admin, { title: 'T', body: 'B', audience: 'ALL' });
    expect(service.create).toHaveBeenCalledWith(admin, { title: 'T', body: 'B', audience: 'ALL' });

    await controller.update('a1', { title: 'T2' });
    expect(service.update).toHaveBeenCalledWith('a1', { title: 'T2' });

    await controller.remove('a1');
    expect(service.remove).toHaveBeenCalledWith('a1');
  });
});
