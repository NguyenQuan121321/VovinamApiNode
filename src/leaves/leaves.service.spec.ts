import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { LeavesService } from './leaves.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const studentCaller: AuthenticatedUser = {
  id: 'student-1',
  role: 'STUDENT',
  sessionId: 's',
  jti: 'j',
};
const adminCaller: AuthenticatedUser = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' };
const instructorCaller: AuthenticatedUser = {
  id: 'instructor-1',
  role: 'INSTRUCTOR',
  sessionId: 's',
  jti: 'j',
};

function makePrismaMock() {
  return {
    leaveRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    class: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn() },
    studentProfile: { findFirst: jest.fn() },
    parentStudentLink: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg as Promise<unknown>[])
        : (arg as (tx: unknown) => unknown)({}),
    ),
  };
}

const row = {
  id: 'lr1',
  studentId: 'sp1',
  student: { fullName: 'Nguyen Van A' },
  classId: 'class-1',
  class: { name: 'Co ban' },
  sessionDate: new Date('2026-10-01T00:00:00Z'),
  reason: 'School event',
  status: 'PENDING',
  reviewNote: null,
  reviewedAt: null,
  createdAt: new Date(),
};

describe('LeavesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: LeavesService;
  let auditRecord: jest.Mock;
  let ownership: { assertCanAccess: jest.Mock; visibleStudentIds: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    const audit = { record: jest.fn() };
    ownership = {
      assertCanAccess: jest.fn().mockResolvedValue(undefined),
      visibleStudentIds: jest.fn().mockResolvedValue(['sp1']),
    };
    service = new LeavesService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      ownership as unknown as StudentOwnershipService,
    );
    auditRecord = audit.record;
  });

  it('creates a request for an enrolled student in an active class', async () => {
    prisma.class.findFirst.mockResolvedValue({ id: 'class-1' });
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.leaveRequest.create.mockResolvedValue(row);
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const result = await service.create(studentCaller, {
      studentId: 'sp1',
      classId: 'class-1',
      sessionDate: future,
      reason: 'School event',
    });
    expect(result).toMatchObject({ status: 'PENDING', studentName: 'Nguyen Van A' });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'leave_request_created' }),
    );
  });

  it('rejects a past session date', async () => {
    await expect(
      service.create(studentCaller, {
        studentId: 'sp1',
        classId: 'class-1',
        sessionDate: '2020-01-01',
        reason: 'X',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a request for a student not enrolled in the class (409)', async () => {
    prisma.class.findFirst.mockResolvedValue({ id: 'class-1' });
    prisma.enrollment.findFirst.mockResolvedValue(null);
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await expect(
      service.create(studentCaller, {
        studentId: 'sp1',
        classId: 'class-1',
        sessionDate: future,
        reason: 'X',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a duplicate request for the same session maps to 409', async () => {
    prisma.class.findFirst.mockResolvedValue({ id: 'class-1' });
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e1' });
    prisma.leaveRequest.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    await expect(
      service.create(studentCaller, {
        studentId: 'sp1',
        classId: 'class-1',
        sessionDate: future,
        reason: 'X',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('an instructor reviews only requests of their own class; foreign class 404s', async () => {
    prisma.leaveRequest.findUnique
      .mockResolvedValueOnce({ ...row, class: { name: 'Co ban', instructorId: 'instructor-1' } })
      .mockResolvedValueOnce({ ...row, class: { name: 'Co ban', instructorId: 'someone-else' } });
    prisma.leaveRequest.update.mockResolvedValue({ ...row, status: 'APPROVED' });

    await service.review(instructorCaller, 'lr1', { status: 'APPROVED' });
    expect(prisma.leaveRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', reviewedByUserId: 'instructor-1' }),
      }),
    );

    await expect(
      service.review(instructorCaller, 'lr1', { status: 'APPROVED' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('only PENDING requests can be reviewed or cancelled', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ...row,
      status: 'APPROVED',
      class: { name: 'Co ban', instructorId: 'instructor-1' },
      student: { userId: 'student-1' },
    });
    await expect(
      service.review(instructorCaller, 'lr1', { status: 'REJECTED' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(service.cancel(studentCaller, 'lr1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a foreign caller cannot cancel a request they do not own (404)', async () => {
    prisma.leaveRequest.findUnique.mockResolvedValue({
      ...row,
      requestedByUserId: 'parent-9',
      student: { userId: null },
    });
    await expect(service.cancel(studentCaller, 'lr1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('scopes the list by the ownership guard; instructors additionally by own class', async () => {
    await service.list(instructorCaller, { page: 1, limit: 20 });
    const where = prisma.leaveRequest.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
    };
    expect(where.where).toMatchObject({
      studentId: { in: ['sp1'] },
      class: { instructorId: 'instructor-1' },
    });
  });

  describe('list scoping and cancel branches', () => {
    it('returns an empty page when the caller can see no students', async () => {
      ownership.visibleStudentIds.mockResolvedValue([]);
      await expect(service.list(studentCaller, { page: 1, limit: 20 })).resolves.toEqual({
        items: [],
        total: 0,
        page: 1,
        limit: 20,
      });
      expect(prisma.leaveRequest.findMany).not.toHaveBeenCalled();
    });

    it('applies status, class and student filters only when provided', async () => {
      ownership.visibleStudentIds.mockResolvedValue(null); // admin: unrestricted
      await service.list(adminCaller, { page: 1, limit: 20 });
      expect(prisma.leaveRequest.count).toHaveBeenCalledWith({ where: {} });

      await service.list(adminCaller, {
        page: 1,
        limit: 20,
        status: 'PENDING',
        classId: 'c-1',
        studentId: 'sp-1',
      });
      expect(prisma.leaveRequest.count).toHaveBeenCalledWith({
        where: { status: 'PENDING', classId: 'c-1', studentId: 'sp-1' },
      });
    });

    it('an admin may cancel any pending request; unknown ids 404', async () => {
      prisma.leaveRequest.findUnique.mockResolvedValue({
        ...row,
        requestedByUserId: 'someone-else',
        student: { userId: null },
      });
      prisma.leaveRequest.update.mockResolvedValue({ ...row, status: 'CANCELLED' });
      await expect(service.cancel(adminCaller, 'lr1')).resolves.toMatchObject({
        status: 'CANCELLED',
      });

      prisma.leaveRequest.findUnique.mockResolvedValue(null);
      await expect(service.cancel(adminCaller, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
