import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { EvaluationsService } from './evaluations.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const instructorCaller: AuthenticatedUser = {
  id: 'instructor-1',
  role: 'INSTRUCTOR',
  sessionId: 's',
  jti: 'j',
};

function makePrismaMock() {
  return {
    studentEvaluation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn(async (arg: unknown) =>
      Array.isArray(arg)
        ? Promise.all(arg as Promise<unknown>[])
        : (arg as (tx: unknown) => unknown)({}),
    ),
  };
}

describe('EvaluationsService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: EvaluationsService;
  let auditRecord: jest.Mock;
  let ownership: { assertCanAccess: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    const audit = { record: jest.fn() };
    ownership = { assertCanAccess: jest.fn().mockResolvedValue(undefined) };
    service = new EvaluationsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      ownership as unknown as StudentOwnershipService,
    );
    auditRecord = audit.record;
  });

  const evaluation = {
    id: 'ev1',
    studentId: 'sp1',
    student: { fullName: 'Van A' },
    authorUserId: 'instructor-1',
    author: { email: 'coach@example.com' },
    classId: null,
    periodMonth: 9,
    periodYear: 2026,
    rating: 8,
    comment: 'Good progress',
    createdAt: new Date(),
  };

  it('records an evaluation with rating and period', async () => {
    prisma.studentEvaluation.create.mockResolvedValue(evaluation);
    const result = await service.create(instructorCaller, {
      studentId: 'sp1',
      periodMonth: 9,
      periodYear: 2026,
      rating: 8,
      comment: 'Good progress',
    });
    expect(result).toMatchObject({ rating: 8, studentName: 'Van A' });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'evaluation_recorded' }),
    );
  });

  it('rejects a half-specified period (400)', async () => {
    await expect(
      service.create(instructorCaller, { studentId: 'sp1', periodMonth: 9, rating: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create(instructorCaller, { studentId: 'sp1', periodYear: 2026, rating: 5 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a duplicate per (student, author, period) maps to 409', async () => {
    prisma.studentEvaluation.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.12.0',
      }),
    );
    await expect(
      service.create(instructorCaller, {
        studentId: 'sp1',
        periodMonth: 9,
        periodYear: 2026,
        rating: 8,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a non-author instructor cannot edit or delete a foreign evaluation (404)', async () => {
    prisma.studentEvaluation.findUnique.mockResolvedValue({
      ...evaluation,
      authorUserId: 'other-instructor',
    });
    await expect(service.update(instructorCaller, 'ev1', { rating: 3 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.delete(instructorCaller, 'ev1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('the author edits their own evaluation', async () => {
    prisma.studentEvaluation.findUnique.mockResolvedValue(evaluation);
    prisma.studentEvaluation.update.mockResolvedValue({ ...evaluation, rating: 9 });
    const result = await service.update(instructorCaller, 'ev1', { rating: 9 });
    expect(result).toMatchObject({ rating: 9 });
  });

  it('unknown ids 404', async () => {
    prisma.studentEvaluation.findUnique.mockResolvedValue(null);
    await expect(service.delete(instructorCaller, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
