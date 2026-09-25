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
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    await this.ownership.assertCanAccess(caller, studentId);
    const sessionDate: Prisma.DateTimeFilter = {
      ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
      ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
    };
    const where: Prisma.AttendanceRecordWhereInput = {
      studentId,
      ...(query.from === undefined && query.to === undefined ? {} : { session: { sessionDate } }),
    };
    const [records, total] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.findMany({
        where,
        include: { session: { include: { class: { select: { name: true } } } } },
        orderBy: { session: { sessionDate: 'desc' } },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.attendanceRecord.count({ where }),
    ]);
    return {
      items: records.map((record) => ({
        sessionId: record.attendanceSessionId,
        sessionDate: record.session.sessionDate,
        classId: record.session.classId,
        className: record.session.class.name,
        status: record.status,
        note: record.note,
      })),
      total,
      page: query.page,
      limit: query.limit,
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

  /**
   * Attendance report for one month (matrix row 26): per-class session counts and
   * status totals. ADMIN sees the whole club; INSTRUCTOR only the classes they
   * teach — the same scoping rule as attendance writes (plan 7.3/7.4).
   */
  async monthlyReport(
    caller: AuthenticatedUser,
    month: number,
    year: number,
  ): Promise<Array<Record<string, unknown>>> {
    const rangeStart = new Date(Date.UTC(year, month - 1, 1));
    const rangeEnd = new Date(Date.UTC(year, month, 1));
    const classWhere: Prisma.ClassWhereInput =
      caller.role === 'ADMIN' ? {} : { instructorId: caller.id, status: { not: 'ARCHIVED' } };
    const classes = await this.prisma.class.findMany({
      where: classWhere,
      select: { id: true, name: true, status: true },
    });
    if (classes.length === 0) return [];
    const sessions = await this.prisma.attendanceSession.findMany({
      where: {
        classId: { in: classes.map((c) => c.id) },
        sessionDate: { gte: rangeStart, lt: rangeEnd },
      },
      select: { id: true, classId: true },
    });
    const records = await this.prisma.attendanceRecord.groupBy({
      by: ['status', 'attendanceSessionId'],
      where: { attendanceSessionId: { in: sessions.map((s) => s.id) } },
      _count: { _all: true },
    });
    const statusBySession = new Map<string, Record<string, number>>();
    for (const row of records) {
      const bucket = statusBySession.get(row.attendanceSessionId) ?? {};
      bucket[row.status] = row._count._all;
      statusBySession.set(row.attendanceSessionId, bucket);
    }
    return classes.map((club) => {
      const classSessions = sessions.filter((s) => s.classId === club.id);
      let present = 0;
      let late = 0;
      let absent = 0;
      let excused = 0;
      for (const session of classSessions) {
        for (const [status, count] of Object.entries(statusBySession.get(session.id) ?? {})) {
          if (status === 'PRESENT') present += count;
          else if (status === 'LATE') late += count;
          else if (status === 'ABSENT') absent += count;
          else if (status === 'EXCUSED') excused += count;
        }
      }
      const marked = present + late + absent + excused;
      return {
        classId: club.id,
        className: club.name,
        sessionsHeld: classSessions.length,
        PRESENT: present,
        LATE: late,
        ABSENT: absent,
        EXCUSED: excused,
        markedRecords: marked,
        attendanceRate: marked === 0 ? null : Math.round(((present + late) / marked) * 1000) / 10,
      };
    });
  }
}
