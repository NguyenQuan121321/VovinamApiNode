import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type AttendanceStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import { ClassesService } from '../classes/classes.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type {
  AttendanceHistoryQueryDto,
  AttendanceSummaryQueryDto,
  BulkAttendanceRecordsDto,
  CreateAttendanceSessionDto,
} from './dto/attendance.dto';

/** [start, end) month window in UTC — session_date is a DATE bucket. */
function monthRange(month: string): { start: Date; end: Date } {
  const [year, monthIndex] = month.split('-').map(Number) as [number, number];
  return {
    start: new Date(Date.UTC(year, monthIndex - 1, 1)),
    end: new Date(Date.UTC(year, monthIndex, 1)),
  };
}

/**
 * Attendance (plan sections 6, 8): sessions and bulk record upserts are managed
 * by ADMIN or the class's own INSTRUCTOR (foreign classes answer 404, plan 7.3);
 * per-student history and monthly summaries go through the ownership guard.
 */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly classes: ClassesService,
    private readonly ownership: StudentOwnershipService,
  ) {}

  async createSession(
    caller: AuthenticatedUser,
    dto: CreateAttendanceSessionDto,
  ): Promise<Record<string, unknown>> {
    const cls = await this.classes.assertManageable(caller, dto.classId);
    // No new lessons for paused or archived classes; correcting records of an
    // existing session stays possible.
    if (cls.status !== 'ACTIVE') {
      throw new ConflictException('Class is not active');
    }
    const sessionDate = new Date(dto.sessionDate);
    // An admin creating the session records the class's own instructor as the teacher.
    const instructorId = caller.role === 'INSTRUCTOR' ? caller.id : cls.instructorId;
    try {
      const session = await this.prisma.attendanceSession.create({
        data: { classId: dto.classId, sessionDate, instructorId, topic: dto.topic },
      });
      this.audit.record({
        event: 'attendance_session_created',
        success: true,
        detail: `session:${session.id} class:${dto.classId}`,
      });
      return this.serializeSession(session);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Attendance session already exists for this date');
      }
      throw error;
    }
  }

  async upsertRecords(
    caller: AuthenticatedUser,
    sessionId: string,
    dto: BulkAttendanceRecordsDto,
  ): Promise<Array<Record<string, unknown>>> {
    const session = await this.assertSessionAccessible(caller, sessionId);
    const seen = new Set<string>();
    for (const record of dto.records) {
      if (seen.has(record.studentId)) {
        throw new BadRequestException('Duplicate students in records');
      }
      seen.add(record.studentId);
    }
    const enrolled = await this.prisma.enrollment.findMany({
      where: { classId: session.classId, leftAt: null, studentId: { in: [...seen] } },
      select: { studentId: true },
    });
    if (enrolled.length !== seen.size) {
      throw new BadRequestException('Some students are not enrolled in this class');
    }
    const records = await this.prisma.$transaction(
      dto.records.map((record) =>
        this.prisma.attendanceRecord.upsert({
          where: {
            attendanceSessionId_studentId: {
              attendanceSessionId: sessionId,
              studentId: record.studentId,
            },
          },
          create: {
            attendanceSessionId: sessionId,
            studentId: record.studentId,
            status: record.status,
            note: record.note,
            recordedBy: caller.id,
          },
          update: { status: record.status, note: record.note, recordedBy: caller.id },
        }),
      ),
    );
    this.audit.record({
      event: 'attendance_recorded',
      success: true,
      detail: `session:${sessionId} records:${records.length}`,
    });
    return records.map((record) => this.serializeRecord(record));
  }

  async listRecords(
    caller: AuthenticatedUser,
    sessionId: string,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    await this.assertSessionAccessible(caller, sessionId);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { attendanceSessionId: sessionId },
      include: { student: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: records.map((record) => this.serializeRecord(record)),
      total: records.length,
    };
  }

  /** Attendance history for one student, guarded by plan 7.3 for every role. */
  async history(
    caller: AuthenticatedUser,
    studentId: string,
    query: AttendanceHistoryQueryDto,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    await this.ownership.assertCanAccess(caller, studentId);
    const sessionDate: Prisma.DateTimeFilter = {
      ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
      ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
    };
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        studentId,
        ...(query.from === undefined && query.to === undefined ? {} : { session: { sessionDate } }),
      },
      include: { session: { include: { class: { select: { name: true } } } } },
      orderBy: { session: { sessionDate: 'desc' } },
    });
    return {
      items: records.map((record) => ({
        sessionId: record.attendanceSessionId,
        sessionDate: record.session.sessionDate,
        classId: record.session.classId,
        className: record.session.class.name,
        status: record.status,
        note: record.note,
      })),
      total: records.length,
    };
  }

  /** Monthly present/late/absent/excused counts (plan 8). */
  async summary(
    caller: AuthenticatedUser,
    query: AttendanceSummaryQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.ownership.assertCanAccess(caller, query.studentId);
    const { start, end } = monthRange(query.month);
    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        studentId: query.studentId,
        session: { sessionDate: { gte: start, lt: end } },
      },
      select: { status: true },
    });
    const counts: Record<AttendanceStatus, number> = {
      PRESENT: 0,
      LATE: 0,
      ABSENT: 0,
      EXCUSED: 0,
    };
    for (const record of records) {
      counts[record.status] += 1;
    }
    return { studentId: query.studentId, month: query.month, ...counts, total: records.length };
  }

  /** ADMIN sees every session; an INSTRUCTOR only sessions of classes they teach (404 otherwise). */
  private async assertSessionAccessible(caller: AuthenticatedUser, sessionId: string) {
    const session = await this.prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      include: { class: { select: { instructorId: true } } },
    });
    if (
      session === null ||
      (caller.role === 'INSTRUCTOR' && session.class.instructorId !== caller.id)
    ) {
      throw new NotFoundException('Not found');
    }
    if (caller.role !== 'ADMIN' && caller.role !== 'INSTRUCTOR') {
      throw new NotFoundException('Not found');
    }
    return session;
  }

  private serializeSession(session: {
    id: string;
    classId: string;
    sessionDate: Date;
    instructorId: string;
    topic: string | null;
  }): Record<string, unknown> {
    return {
      id: session.id,
      classId: session.classId,
      sessionDate: session.sessionDate,
      instructorId: session.instructorId,
      topic: session.topic,
    };
  }

  private serializeRecord(record: {
    id: string;
    studentId: string;
    status: string;
    note: string | null;
    student?: { fullName: string } | null;
  }): Record<string, unknown> {
    return {
      id: record.id,
      studentId: record.studentId,
      fullName: record.student?.fullName ?? null,
      status: record.status,
      note: record.note,
    };
  }
}
