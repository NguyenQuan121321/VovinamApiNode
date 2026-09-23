import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PageDto } from '../common/pagination.dto';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

/**
 * In-app notification feed (plan 7.6, 8): a user sees only their own rows and
 * marks only their own rows read. Foreign/unknown ids answer the uniform 404
 * (no existence disclosure).
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMine(
    caller: AuthenticatedUser,
    query: PageDto,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Prisma.NotificationWhereInput = { userId: caller.id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          channel: true,
          templateCode: true,
          payload: true,
          status: true,
          readAt: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items: rows, total, page: query.page, limit: query.limit };
  }

  async markRead(caller: AuthenticatedUser, id: string): Promise<{ id: string; readAt: Date }> {
    const now = new Date();
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId: caller.id, readAt: null },
      data: { readAt: now },
    });
    if (updated.count === 0) {
      // Either not owned, unknown, or already read: unknown/not-owned must not
      // be distinguishable, so a second read of the same row is a no-op 200.
      const own = await this.prisma.notification.findFirst({
        where: { id, userId: caller.id },
        select: { id: true, readAt: true },
      });
      if (own === null) {
        throw new NotFoundException('Not found');
      }
      return { id: own.id, readAt: own.readAt as Date };
    }
    return { id, readAt: now };
  }
}
