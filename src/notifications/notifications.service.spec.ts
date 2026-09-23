import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const user = { id: 'u-1', role: 'STUDENT', sessionId: 's', jti: 'j' } as AuthenticatedUser;

function makePrismaMock() {
  return {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (arg: unknown) => Promise.all(arg as Promise<unknown>[])),
  };
}

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: NotificationsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new NotificationsService(prisma as unknown as PrismaService);
  });

  it('lists only the caller rows with the standard envelope', async () => {
    prisma.notification.findMany.mockResolvedValue([{ id: 'n-1' }]);
    prisma.notification.count.mockResolvedValue(1);
    const result = await service.listMine(user, { page: 2, limit: 10 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: user.id },
        skip: 10,
        take: 10,
      }),
    );
    expect(result).toEqual({ items: [{ id: 'n-1' }], total: 1, page: 2, limit: 10 });
  });

  it('marks an own unread row read', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    const result = await service.markRead(user, 'n-1');
    expect(prisma.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n-1', userId: user.id, readAt: null } }),
    );
    expect(result.id).toBe('n-1');
    expect(result.readAt).toBeInstanceOf(Date);
  });

  it('answers the existing readAt for an already-read row (idempotent, no 404)', async () => {
    const readAt = new Date('2026-09-10T00:00:00Z');
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue({ id: 'n-1', readAt });
    const result = await service.markRead(user, 'n-1');
    expect(result).toEqual({ id: 'n-1', readAt });
  });

  it('throws the uniform 404 for a foreign or unknown notification id', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue(null);
    await expect(service.markRead(user, 'n-foreign')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.notification.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'n-foreign', userId: user.id } }),
    );
  });
});
