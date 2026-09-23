import { NotificationsController } from './notifications.controller';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

describe('NotificationsController', () => {
  const notifications = {
    listMine: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    markRead: jest.fn().mockResolvedValue({ id: 'n-1', readAt: new Date() }),
  };
  const outbox = { runOnce: jest.fn().mockResolvedValue(undefined) };
  const controller = new NotificationsController(notifications as never, outbox as never);
  const user = { id: 'u-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as AuthenticatedUser;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates the feed to the service with the caller', async () => {
    await controller.feed(user, { page: 1, limit: 20 });
    expect(notifications.listMine).toHaveBeenCalledWith(user, { page: 1, limit: 20 });
  });

  it('delegates mark-read with the parsed uuid', async () => {
    await controller.markRead(user, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(notifications.markRead).toHaveBeenCalledWith(
      user,
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );
  });

  it('delegates the admin worker flush', async () => {
    await expect(controller.flush()).resolves.toEqual({ flushed: true });
    expect(outbox.runOnce).toHaveBeenCalledTimes(1);
  });
});
