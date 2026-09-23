import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type {
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

/**
 * Club activity announcements (plan sections 6, 8; AD-07): curated content with
 * an audience — the whole club or one class. The read API is the thesis feed;
 * audience membership derives from existing relationship data only (enrollment,
 * verified parent link, class instructorship), never from new tables.
 */
@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Feed (plan 8): ALL announcements reach every authenticated user; CLASS
   * announcements reach only users with a legitimate relationship to the class.
   * ADMIN sees everything.
   */
  async list(
    caller: AuthenticatedUser,
    query: ListAnnouncementsQueryDto,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Prisma.AnnouncementWhereInput =
      caller.role === 'ADMIN' ? {} : { OR: [{ audience: 'ALL' }, this.classAudience(caller)] };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        include: { class: { select: { name: true } } },
        orderBy: { publishedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.announcement.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.serialize(row)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async create(
    caller: AuthenticatedUser,
    dto: CreateAnnouncementDto,
  ): Promise<Record<string, unknown>> {
    const classId = await this.resolveClassTarget(dto.audience, dto.classId);
    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        body: dto.body,
        audience: dto.audience,
        classId,
        createdBy: caller.id,
      },
      include: { class: { select: { name: true } } },
    });
    this.audit.record({
      event: 'announcement_created',
      success: true,
      detail: `announcement:${created.id} audience:${created.audience}`,
    });
    return this.serialize(created);
  }

  /**
   * Partial edit. The effective audience/classId pair must stay consistent
   * (audience=ALL clears the class target; audience=CLASS requires one).
   */
  async update(id: string, dto: UpdateAnnouncementDto): Promise<Record<string, unknown>> {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    const audience = dto.audience ?? existing.audience;
    // Switching to ALL without an explicit classId drops the inherited class
    // target; an explicit classId on a club-wide announcement stays a 400.
    const classId =
      audience === 'ALL' && dto.classId === undefined
        ? null
        : await this.resolveClassTarget(audience, dto.classId ?? existing.classId);
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: { title: dto.title, body: dto.body, audience, classId },
      include: { class: { select: { name: true } } },
    });
    this.audit.record({
      event: 'announcement_updated',
      success: true,
      detail: `announcement:${id}`,
    });
    return this.serialize(updated);
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    const removed = await this.prisma.announcement.deleteMany({ where: { id } });
    if (removed.count === 0) {
      throw new NotFoundException('Not found');
    }
    this.audit.record({
      event: 'announcement_deleted',
      success: true,
      detail: `announcement:${id}`,
    });
    return { deleted: true };
  }

  /**
   * CLASS audience requires an existing class; ALL audience carries no class
   * (the audience/class_id consistency rule the schema leaves to the service).
   */
  private async resolveClassTarget(
    audience: 'ALL' | 'CLASS',
    classId: string | undefined | null,
  ): Promise<string | null> {
    if (audience === 'ALL') {
      if (classId !== undefined && classId !== null) {
        throw new BadRequestException('A club-wide announcement cannot target a class');
      }
      return null;
    }
    if (classId === undefined || classId === null) {
      throw new BadRequestException('A class announcement needs a class');
    }
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { id: true },
    });
    if (cls === null) {
      throw new NotFoundException('Not found');
    }
    return cls.id;
  }

  /** Classes this caller has a legitimate relationship with (AD-07 §13.6). */
  private classAudience(caller: AuthenticatedUser): Prisma.AnnouncementWhereInput {
    const classOptions: Prisma.ClassWhereInput[] = [];
    if (caller.role === 'INSTRUCTOR') {
      // Teaching the class is a relationship; being taught by it is not.
      classOptions.push({ instructorId: caller.id });
    }
    classOptions.push({
      enrollments: {
        some: {
          leftAt: null,
          student: {
            OR: [
              { userId: caller.id },
              { parentLinks: { some: { parentUserId: caller.id, verified: true } } },
            ],
          },
        },
      },
    });
    return { audience: 'CLASS', class: { OR: classOptions } };
  }

  private serialize(row: {
    id: string;
    title: string;
    body: string;
    audience: string;
    classId: string | null;
    publishedAt: Date;
    createdAt: Date;
    updatedAt: Date;
    class?: { name: string } | null;
  }): Record<string, unknown> {
    return {
      id: row.id,
      title: row.title,
      body: row.body,
      audience: row.audience,
      classId: row.classId,
      className: row.class?.name ?? null,
      publishedAt: row.publishedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
