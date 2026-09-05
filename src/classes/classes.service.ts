import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Class } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { parseHhMm } from './time';
import { serializeClass } from './serialize-class';
import type {
  CreateClassDto,
  CreateScheduleDto,
  ListClassesQueryDto,
  UpdateClassDto,
} from './dto/classes.dto';

/**
 * Classes and schedules (plan sections 6, 8). Reading is open to any
 * authenticated role; writes are ADMIN. Instructor-scoped attendance lives in
 * the attendance module, which reuses assertManageable.
 */
@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListClassesQueryDto): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where = { ...(query.status === undefined ? {} : { status: query.status }) };
    const [classes, total] = await this.prisma.$transaction([
      this.prisma.class.findMany({
        where,
        include: { schedules: true },
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.class.count({ where }),
    ]);
    return {
      items: classes.map((cls) => serializeClass(cls, cls.schedules)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async getById(classId: string): Promise<Record<string, unknown>> {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      include: {
        schedules: true,
        _count: { select: { enrollments: { where: { leftAt: null } } } },
      },
    });
    if (cls === null) {
      throw new NotFoundException('Not found');
    }
    return serializeClass(cls, cls.schedules, cls._count.enrollments);
  }

  async create(dto: CreateClassDto): Promise<Record<string, unknown>> {
    await this.assertInstructorUser(dto.instructorId);
    const cls = await this.prisma.class.create({
      data: {
        name: dto.name,
        instructorId: dto.instructorId,
        location: dto.location,
        capacity: dto.capacity,
      },
    });
    this.audit.record({ event: 'class_created', success: true, detail: `class:${cls.id}` });
    return serializeClass(cls);
  }

  async update(classId: string, dto: UpdateClassDto): Promise<Record<string, unknown>> {
    await this.assertClassExists(classId);
    if (dto.instructorId !== undefined) {
      await this.assertInstructorUser(dto.instructorId);
    }
    const updated = await this.prisma.class.update({ where: { id: classId }, data: dto });
    this.audit.record({ event: 'class_updated', success: true, detail: `class:${classId}` });
    return serializeClass(updated);
  }

  async addSchedule(classId: string, dto: CreateScheduleDto): Promise<Record<string, unknown>> {
    await this.assertClassExists(classId);
    const start = parseHhMm(dto.startTime);
    const end = parseHhMm(dto.endTime);
    if (start.getTime() >= end.getTime()) {
      throw new BadRequestException('Start time must be before end time');
    }
    if (dto.effectiveTo !== undefined && new Date(dto.effectiveTo) < new Date(dto.effectiveFrom)) {
      throw new BadRequestException('Effective end date must not precede the start date');
    }
    const schedule = await this.prisma.classSchedule.create({
      data: {
        classId,
        weekday: dto.weekday,
        startTime: start,
        endTime: end,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo === undefined ? undefined : new Date(dto.effectiveTo),
      },
    });
    return { id: schedule.id, classId: schedule.classId };
  }

  async removeSchedule(classId: string, scheduleId: string): Promise<{ removed: boolean }> {
    const schedule = await this.prisma.classSchedule.findFirst({
      where: { id: scheduleId, classId },
      select: { id: true },
    });
    if (schedule === null) {
      throw new NotFoundException('Not found');
    }
    await this.prisma.classSchedule.delete({ where: { id: scheduleId } });
    return { removed: true };
  }

  /**
   * Shared gate for management surfaces (attendance sessions and records):
   * ADMIN may act on any class, an INSTRUCTOR only on classes they teach — a
   * foreign class answers 404 so ids cannot be probed (plan 7.3 semantics).
   */
  async assertManageable(caller: AuthenticatedUser, classId: string): Promise<Class> {
    const cls = await this.prisma.class.findUnique({ where: { id: classId } });
    if (
      cls === null ||
      (caller.role !== 'ADMIN' && caller.role !== 'INSTRUCTOR') ||
      (caller.role === 'INSTRUCTOR' && cls.instructorId !== caller.id)
    ) {
      throw new NotFoundException('Not found');
    }
    return cls;
  }

  private async assertClassExists(classId: string): Promise<Class> {
    const cls = await this.prisma.class.findUnique({ where: { id: classId } });
    if (cls === null) {
      throw new NotFoundException('Not found');
    }
    return cls;
  }

  private async assertInstructorUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      select: { role: true },
    });
    if (user === null) {
      throw new NotFoundException('Not found');
    }
    if (user.role !== 'INSTRUCTOR') {
      throw new BadRequestException('Class instructor must have the INSTRUCTOR role');
    }
  }
}
