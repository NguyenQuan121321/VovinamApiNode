import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { serializeStudent } from '../students/serialize-student';
import type { CreateEnrollmentDto, ListEnrollmentsQueryDto } from './dto/enrollments.dto';

/** UTC midnight of "today" — matches the Postgres `enrolled_at::date` bucket (UTC). */
function startOfUtcDay(date: Date): Date {
  const day = new Date(date);
  day.setUTCHours(0, 0, 0, 0);
  return day;
}

/**
 * Enrollment management (plan section 8, ADMIN only). Removal is a soft leave
 * (left_at set): attendance history and reports must survive, and the FK chain
 * stays intact (plan 7.2).
 */
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateEnrollmentDto): Promise<Record<string, unknown>> {
    const created = await this.prisma.$transaction(async (tx) => {
      const cls = await tx.class.findUnique({ where: { id: dto.classId } });
      if (cls === null) {
        throw new NotFoundException('Not found');
      }
      if (cls.status !== 'ACTIVE') {
        throw new ConflictException('Class is not active');
      }
      const profile = await tx.studentProfile.findFirst({
        where: { id: dto.studentId, deletedAt: null },
      });
      if (profile === null) {
        throw new NotFoundException('Not found');
      }
      if (profile.status !== 'ACTIVE') {
        throw new ConflictException('Student profile is not active');
      }
      const now = new Date();
      const open = await tx.enrollment.findFirst({
        where: { studentId: dto.studentId, classId: dto.classId, leftAt: null },
        select: { id: true },
      });
      if (open !== null) {
        throw new ConflictException('Student is already enrolled in this class');
      }
      // Plan section 6: UQ(student_id, class_id, enrolled_at::date) — rejoining
      // is allowed on a later day only.
      const sameDay = await tx.enrollment.findFirst({
        where: {
          studentId: dto.studentId,
          classId: dto.classId,
          enrolledAt: { gte: startOfUtcDay(now) },
        },
        select: { id: true },
      });
      if (sameDay !== null) {
        throw new ConflictException('Student was already enrolled in this class today');
      }
      const activeCount = await tx.enrollment.count({
        where: { classId: dto.classId, leftAt: null },
      });
      if (activeCount >= cls.capacity) {
        throw new ConflictException('Class is full');
      }
      return tx.enrollment.create({
        data: { studentId: dto.studentId, classId: dto.classId, enrolledAt: now },
        include: { student: true, class: { select: { name: true, status: true } } },
      });
    });
    this.audit.record({
      event: 'enrollment_created',
      success: true,
      detail: `enrollment:${created.id} student:${dto.studentId} class:${dto.classId}`,
    });
    return this.serialize(created);
  }

  async list(query: ListEnrollmentsQueryDto): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Prisma.EnrollmentWhereInput = {
      ...(query.classId === undefined ? {} : { classId: query.classId }),
      ...(query.studentId === undefined ? {} : { studentId: query.studentId }),
    };
    const [enrollments, total] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({
        where,
        include: { student: true, class: { select: { name: true, status: true } } },
        orderBy: { enrolledAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.enrollment.count({ where }),
    ]);
    return {
      items: enrollments.map((e) => this.serialize(e)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async remove(enrollmentId: string): Promise<{ left: boolean }> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id: enrollmentId, leftAt: null },
      select: { id: true },
    });
    if (enrollment === null) {
      throw new NotFoundException('Not found');
    }
    await this.prisma.enrollment.update({
      where: { id: enrollmentId },
      data: { leftAt: new Date() },
    });
    this.audit.record({
      event: 'enrollment_removed',
      success: true,
      detail: `enrollment:${enrollmentId}`,
    });
    return { left: true };
  }

  private serialize(
    enrollment: Prisma.EnrollmentGetPayload<{
      include: { student: true; class: { select: { name: true; status: true } } };
    }>,
  ): Record<string, unknown> {
    return {
      id: enrollment.id,
      student: serializeStudent(enrollment.student, 'ADMIN'),
      classId: enrollment.classId,
      className: enrollment.class.name,
      classStatus: enrollment.class.status,
      enrolledAt: enrollment.enrolledAt,
      leftAt: enrollment.leftAt,
    };
  }
}
