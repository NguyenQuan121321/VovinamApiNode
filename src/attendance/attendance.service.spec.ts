import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AttendanceService } from './attendance.service';
import { ClassesService } from '../classes/classes.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const admin = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as AuthenticatedUser;
const instructor = {
  id: 'inst-1',
  role: 'INSTRUCTOR',
  sessionId: 's',
  jti: 'j',
} as AuthenticatedUser;

const cls = {
  id: 'class-1',
  name: 'White Belt A',
  instructorId: 'inst-1',
  location: null,
  capacity: 30,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const session = {
  id: 'sess-1',
  classId: 'class-1',
  sessionDate: new Date('2026-09-06'),
  instructorId: 'inst-1',
  topic: 'Basic don chan',
  createdAt: new Date(),
  class: { instructorId: 'inst-1' },
};

const record = {
  id: 'r-1',
  attendanceSessionId: 'sess-1',
  studentId: 'sp-1',
  status: 'PRESENT',
  note: null,
  recordedBy: 'inst-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  return {
    attendanceSession: { create: jest.fn(), findUnique: jest.fn() },
    attendanceRecord: { upsert: jest.fn(), findMany: jest.fn() },
    enrollment: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock) {
  prisma.$transaction.mockImplementation(async (ops: unknown) =>
    Promise.all(ops as Promise<unknown>[]),
  );
  const audit = { record: jest.fn() };
  const classes = { assertManageable: jest.fn().mockResolvedValue(cls) };
  const ownership = { assertCanAccess: jest.fn().mockResolvedValue(undefined) };
  const service = new AttendanceService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    classes as unknown as ClassesService,
    ownership as unknown as StudentOwnershipService,
  );
  return {
    service,
    auditRecord: audit.record as jest.Mock,
    classes: classes as { assertManageable: jest.Mock },
    ownership: ownership as { assertCanAccess: jest.Mock },
  };
}

describe('AttendanceService', () => {
  let prisma: PrismaMock;
  let service: AttendanceService;
  let auditRecord: jest.Mock;
  let classes: { assertManageable: jest.Mock };
  let ownership: { assertCanAccess: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, auditRecord, classes, ownership } = makeService(prisma));
  });

  describe('createSession', () => {
    it('creates a session for the owning instructor and audits it', async () => {
      prisma.attendanceSession.create.mockResolvedValue(session);
      await expect(
        service.createSession(instructor, { classId: 'class-1', sessionDate: '2026-09-06' }),
      ).resolves.toMatchObject({ id: 'sess-1', instructorId: 'inst-1' });
      expect(classes.assertManageable).toHaveBeenCalledWith(instructor, 'class-1');
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'attendance_session_created', success: true }),
      );
    });

    it('records the class instructor when an admin creates the session', async () => {
      prisma.attendanceSession.create.mockResolvedValue({ ...session, instructorId: 'inst-1' });
      await service.createSession(admin, { classId: 'class-1', sessionDate: '2026-09-06' });
      expect(prisma.attendanceSession.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ instructorId: 'inst-1' }) }),
      );
    });

    it('maps the unique (class, date) violation to a 409', async () => {
      prisma.attendanceSession.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.12.0',
        }),
      );
      await expect(
        service.createSession(instructor, { classId: 'class-1', sessionDate: '2026-09-06' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('upsertRecords', () => {
    it('upserts every record with the caller as recorder', async () => {
      prisma.attendanceSession.findUnique.mockResolvedValue(session);
      prisma.enrollment.findMany.mockResolvedValue([{ studentId: 'sp-1' }]);
      prisma.attendanceRecord.upsert.mockResolvedValue({ ...record, student: { fullName: 'A B' } });
      const result = await service.upsertRecords(instructor, 'sess-1', {
        records: [{ studentId: 'sp-1', status: 'PRESENT' }],
      });
      expect(result[0]).toMatchObject({ studentId: 'sp-1', fullName: 'A B' });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'attendance_recorded', success: true }),
      );
    });

    it('rejects duplicates and non-enrolled students (all-or-nothing)', async () => {
      prisma.attendanceSession.findUnique.mockResolvedValue(session);
      await expect(
        service.upsertRecords(instructor, 'sess-1', {
          records: [
            { studentId: 'sp-1', status: 'PRESENT' },
            { studentId: 'sp-1', status: 'LATE' },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.enrollment.findMany.mockResolvedValue([]); // nobody enrolled
      await expect(
        service.upsertRecords(instructor, 'sess-1', {
          records: [{ studentId: 'sp-1', status: 'PRESENT' }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('hides sessions of foreign classes behind a uniform 404 (S-04)', async () => {
      prisma.attendanceSession.findUnique.mockResolvedValue({
        ...session,
        class: { instructorId: 'other-inst' },
      });
      await expect(
        service.upsertRecords(instructor, 'sess-1', {
          records: [{ studentId: 'sp-1', status: 'PRESENT' }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listRecords(instructor, 'sess-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      prisma.attendanceSession.findUnique.mockResolvedValue(null);
      await expect(service.listRecords(admin, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('history and summary', () => {
    it('scopes history through the ownership guard and includes class context', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        {
          ...record,
          studentId: 'sp-1',
          session: {
            id: 'sess-1',
            classId: 'class-1',
            sessionDate: new Date('2026-09-06'),
            class: { name: 'White Belt A' },
          },
        },
      ]);
      const result = await service.history(admin, 'sp-1', {});
      expect(ownership.assertCanAccess).toHaveBeenCalledWith(admin, 'sp-1');
      expect(result).toMatchObject({ total: 1 });
      expect(result.items[0]).toMatchObject({ className: 'White Belt A', status: 'PRESENT' });
    });

    it('summarizes monthly counts per status', async () => {
      prisma.attendanceRecord.findMany.mockResolvedValue([
        { status: 'PRESENT' },
        { status: 'PRESENT' },
        { status: 'LATE' },
        { status: 'ABSENT' },
        { status: 'EXCUSED' },
      ]);
      await expect(
        service.summary(admin, { studentId: 'sp-1', month: '2026-09' }),
      ).resolves.toMatchObject({
        studentId: 'sp-1',
        month: '2026-09',
        PRESENT: 2,
        LATE: 1,
        ABSENT: 1,
        EXCUSED: 1,
        total: 5,
      });
      const where = prisma.attendanceRecord.findMany.mock.calls[0][0].where;
      expect(where.session.sessionDate).toEqual({
        gte: new Date(Date.UTC(2026, 8, 1)),
        lt: new Date(Date.UTC(2026, 9, 1)),
      });
    });
  });
});
