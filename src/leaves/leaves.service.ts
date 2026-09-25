import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type {
  CreateLeaveRequestDto,
  ListLeaveRequestsQueryDto,
  ReviewLeaveRequestDto,
} from './dto/leaves.dto';

function serializeLeaveRequest(request: {
  id: string;
  studentId: string;
  student: { fullName: string };
  classId: string;
  class: { name: string };
  sessionDate: Date;
  reason: string;
  status: string;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}): Record<string, unknown> {
  return {
    id: request.id,
    studentId: request.studentId,
    studentName: request.student.fullName,
    classId: request.classId,
    className: request.class.name,
    sessionDate: request.sessionDate,
    reason: request.reason,
    status: request.status,
    reviewNote: request.reviewNote,
    reviewedAt: request.reviewedAt,
    createdAt: request.createdAt,
  };
}

const REQUEST_INCLUDE = {
  student: { select: { fullName: true } },
  class: { select: { name: true } },
} as const;

/**
 * Absence requests ("xin nghỉ", matrix row 11): students (or linked parents) ask
 * to miss one class session; the class instructor or an admin approves. Row
 * ownership follows guard 7.3 with the uniform 404 posture; instructors review
 * only requests for the classes they teach.
 */
@Injectable()
export class LeavesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ownership: StudentOwnershipService,
  ) {}

  async create(
    caller: AuthenticatedUser,
    dto: CreateLeaveRequestDto,
  ): Promise<Record<string, unknown>> {
    await this.ownership.assertCanAccess(caller, dto.studentId);
    const sessionDate = new Date(`${dto.sessionDate.slice(0, 10)}T00:00:00.000Z`);
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    if (Number.isNaN(sessionDate.getTime()) || sessionDate < today) {
      throw new BadRequestException('The requested session date must be today or later');
    }
    const clubClass = await this.prisma.class.findFirst({
      where: { id: dto.classId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (clubClass === null) {
      throw new NotFoundException('Not found');
    }
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { studentId: dto.studentId, classId: dto.classId, leftAt: null },
      select: { id: true },
    });
    if (enrollment === null) {
      throw new ConflictException('The student is not enrolled in this class');
    }
    try {
      const request = await this.prisma.leaveRequest.create({
        data: {
          studentId: dto.studentId,
          classId: dto.classId,
          requestedByUserId: caller.id,
          sessionDate,
          reason: dto.reason,
        },
        include: REQUEST_INCLUDE,
      });
      this.audit.record({
        userId: caller.id,
        event: 'leave_request_created',
        success: true,
        detail: `request:${request.id} student:${dto.studentId} date:${dto.sessionDate.slice(0, 10)}`,
      });
      return serializeLeaveRequest(request);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A leave request for this session already exists');
      }
      throw error;
    }
  }

  async list(
    caller: AuthenticatedUser,
    query: ListLeaveRequestsQueryDto,
  ): Promise<Record<string, unknown>> {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const visible = await this.ownership.visibleStudentIds(caller);
    if (visible !== null && visible.length === 0) {
      return { items: [], total: 0, page, limit };
    }
    const where: Prisma.LeaveRequestWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.classId === undefined ? {} : { classId: query.classId }),
      ...(query.studentId === undefined ? {} : { studentId: query.studentId }),
      ...(visible === null ? {} : { studentId: { in: visible } }),
      ...(caller.role === 'INSTRUCTOR' ? { class: { instructorId: caller.id } } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.leaveRequest.count({ where }),
      this.prisma.leaveRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { items: items.map(serializeLeaveRequest), total, page, limit };
  }

  async review(
    caller: AuthenticatedUser,
    id: string,
    dto: ReviewLeaveRequestDto,
  ): Promise<Record<string, unknown>> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { ...REQUEST_INCLUDE, class: { select: { name: true, instructorId: true } } },
    });
    if (request === null) {
      throw new NotFoundException('Not found');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('Only pending requests can be reviewed');
    }
    if (caller.role === 'INSTRUCTOR' && request.class.instructorId !== caller.id) {
      // Uniform 404: instructors cannot probe request ids of other classes.
      throw new NotFoundException('Not found');
    }
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedByUserId: caller.id,
        reviewedAt: new Date(),
        reviewNote: dto.note,
      },
      include: REQUEST_INCLUDE,
    });
    this.audit.record({
      userId: caller.id,
      event: 'leave_request_reviewed',
      success: true,
      detail: `request:${id} status:${dto.status}`,
    });
    return serializeLeaveRequest(updated);
  }

  async cancel(caller: AuthenticatedUser, id: string): Promise<Record<string, unknown>> {
    const request = await this.prisma.leaveRequest.findUnique({
      where: { id },
      include: { student: { select: { userId: true } } },
    });
    if (request === null) {
      throw new NotFoundException('Not found');
    }
    if (request.status !== 'PENDING') {
      throw new ConflictException('Only pending requests can be cancelled');
    }
    const isOwner = request.requestedByUserId === caller.id || request.student.userId === caller.id;
    if (caller.role !== 'ADMIN' && !isOwner) {
      throw new NotFoundException('Not found');
    }
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: REQUEST_INCLUDE,
    });
    this.audit.record({
      userId: caller.id,
      event: 'leave_request_cancelled',
      success: true,
      detail: `request:${id}`,
    });
    return serializeLeaveRequest(updated);
  }

  async delete(caller: AuthenticatedUser, id: string): Promise<Record<string, unknown>> {
    const existing = await this.prisma.leaveRequest.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    await this.prisma.leaveRequest.delete({ where: { id } });
    this.audit.record({
      userId: caller.id,
      event: 'leave_request_deleted',
      success: true,
      detail: `request:${id}`,
    });
    return { id, deleted: true };
  }
}
