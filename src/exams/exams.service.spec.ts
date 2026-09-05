import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExamsService } from './exams.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import { BillingService } from '../billing/billing.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const student = {
  id: 'sp-1',
  userId: 'u-student',
  fullName: 'Nguyen Van A',
  currentBeltRankId: null as number | null,
  status: 'ACTIVE',
  deletedAt: null as Date | null,
};

const exam = {
  id: 'exam-1',
  code: 'EXAM-2026-03',
  title: 'Mid-term grading',
  examDate: new Date(Date.now() + 14 * 86_400_000),
  location: 'Main hall',
  targetRankId: 4,
  feeAmount: 300000,
  capacity: 30,
  registrationDeadline: new Date(Date.now() + 7 * 86_400_000),
  status: 'OPEN',
};

const createdRegistration = {
  id: 'reg-1',
  examId: 'exam-1',
  studentId: 'sp-1',
  status: 'PENDING_PAYMENT',
  currentRankId: null,
  targetRankId: 4,
  exam: {
    code: 'EXAM-2026-03',
    title: 'Mid-term grading',
    feeAmount: 300000,
    examDate: new Date('2026-03-20'),
  },
  student,
};

function makePrismaMock() {
  return {
    beltExam: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    beltRank: { findUnique: jest.fn(), findMany: jest.fn() },
    studentProfile: { findFirst: jest.fn(), update: jest.fn() },
    examRegistration: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    user: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock) {
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg as Promise<unknown>[])
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  const audit = { record: jest.fn() };
  const ownership = { assertCanAccess: jest.fn().mockResolvedValue(undefined) };
  const billing = {
    createExamFeeInvoice: jest.fn().mockResolvedValue({
      id: 'inv-1',
      invoiceNo: 'INV-2026-0001',
      total: 300000,
      status: 'UNPAID',
    }),
  };
  const service = new ExamsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    ownership as unknown as StudentOwnershipService,
    billing as unknown as BillingService,
  );
  return {
    service,
    auditRecord: audit.record as jest.Mock,
    ownership: ownership as { assertCanAccess: jest.Mock },
    billing: billing as { createExamFeeInvoice: jest.Mock },
  };
}

const studentCaller = {
  id: 'u-student',
  role: 'STUDENT',
  sessionId: 's',
  jti: 'j',
} as AuthenticatedUser;

const instructorCaller = {
  id: 'u-inst',
  role: 'INSTRUCTOR',
  sessionId: 's',
  jti: 'j',
} as AuthenticatedUser;

describe('ExamsService', () => {
  let prisma: PrismaMock;
  let service: ExamsService;
  let auditRecord: jest.Mock;
  let ownership: { assertCanAccess: jest.Mock };
  let billing: { createExamFeeInvoice: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, auditRecord, ownership, billing } = makeService(prisma));
    prisma.beltExam.findUnique.mockResolvedValue(exam);
    prisma.studentProfile.findFirst.mockResolvedValue(student);
    prisma.examRegistration.count.mockResolvedValue(0);
    prisma.examRegistration.findUnique.mockResolvedValue(null);
    prisma.examRegistration.create.mockResolvedValue(createdRegistration);
  });

  describe('register', () => {
    it('creates a registration and an EXAM_FEE invoice atomically', async () => {
      const result = await service.register(studentCaller, 'exam-1', { studentId: 'sp-1' });
      expect(ownership.assertCanAccess).toHaveBeenCalledWith(studentCaller, 'sp-1');
      expect(result).toMatchObject({
        id: 'reg-1',
        status: 'PENDING_PAYMENT',
        invoice: { invoiceNo: 'INV-2026-0001', total: 300000 },
      });
      expect(billing.createExamFeeInvoice).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ studentId: 'sp-1', examRegistrationId: 'reg-1' }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'exam_registration_created', success: true }),
      );
    });

    it('answers a uniform 404 when the caller cannot access the student (S-01)', async () => {
      ownership.assertCanAccess.mockRejectedValue(new NotFoundException('Not found'));
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-other' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.beltExam.findUnique).not.toHaveBeenCalled();
    });

    it('rejects exams that are not OPEN, unknown exams, and past deadlines', async () => {
      prisma.beltExam.findUnique.mockResolvedValue({ ...exam, status: 'DRAFT' });
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-1' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.beltExam.findUnique.mockResolvedValue(null);
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.beltExam.findUnique.mockResolvedValue({
        ...exam,
        registrationDeadline: new Date(Date.now() - 86_400_000),
      });
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects inactive profiles, rank regressions, full exams, and duplicates', async () => {
      prisma.studentProfile.findFirst.mockResolvedValue({ ...student, status: 'PENDING' });
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-1' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.studentProfile.findFirst.mockResolvedValue({ ...student, currentBeltRankId: 4 });
      prisma.beltRank.findMany.mockResolvedValue([
        { id: 4, orderIndex: 10 },
        { id: 4, orderIndex: 10 },
      ]);
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-1' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.studentProfile.findFirst.mockResolvedValue(student);
      prisma.examRegistration.count.mockResolvedValue(30);
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-1' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.examRegistration.count.mockResolvedValue(0);
      prisma.examRegistration.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(
        service.register(studentCaller, 'exam-1', { studentId: 'sp-1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('recordResult', () => {
    const registration = {
      id: 'reg-1',
      examId: 'exam-1',
      studentId: 'sp-1',
      status: 'PENDING_PAYMENT',
      exam: { targetRankId: 4 },
    };

    it('promotes the student rank on PASS and audits the outcome', async () => {
      prisma.examRegistration.findUnique.mockResolvedValue(registration);
      prisma.examRegistration.update.mockResolvedValue({ ...registration, status: 'RESULT_PASS' });
      const result = await service.recordResult(instructorCaller, 'reg-1', {
        status: 'RESULT_PASS',
      });
      expect(result).toMatchObject({ status: 'RESULT_PASS' });
      expect(prisma.examRegistration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RESULT_PASS', examinerId: 'u-inst' }),
        }),
      );
      expect(prisma.studentProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sp-1' },
          data: { currentBeltRankId: 4 },
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'exam_result_recorded', success: true }),
      );
    });

    it('does not touch the rank on FAIL', async () => {
      prisma.examRegistration.findUnique.mockResolvedValue(registration);
      prisma.examRegistration.update.mockResolvedValue({ ...registration, status: 'RESULT_FAIL' });
      await service.recordResult(instructorCaller, 'reg-1', { status: 'RESULT_FAIL' });
      expect(prisma.studentProfile.update).not.toHaveBeenCalled();
    });

    it('guards re-entry, cancelled registrations, and unknown ids', async () => {
      prisma.examRegistration.findUnique.mockResolvedValue({
        ...registration,
        status: 'RESULT_PASS',
      });
      await expect(
        service.recordResult(instructorCaller, 'reg-1', { status: 'RESULT_PASS' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.examRegistration.findUnique.mockResolvedValue({
        ...registration,
        status: 'CANCELLED',
      });
      await expect(
        service.recordResult(instructorCaller, 'reg-1', { status: 'RESULT_PASS' }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.examRegistration.findUnique.mockResolvedValue(null);
      await expect(
        service.recordResult(instructorCaller, 'missing', { status: 'RESULT_PASS' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets only an admin attribute a different examiner', async () => {
      await expect(
        service.recordResult(instructorCaller, 'reg-1', {
          status: 'RESULT_FAIL',
          examinerId: 'u-other',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();

      const adminCaller = {
        id: 'u-admin',
        role: 'ADMIN',
        sessionId: 's',
        jti: 'j',
      } as AuthenticatedUser;
      prisma.examRegistration.findUnique.mockResolvedValue(registration);
      prisma.examRegistration.update.mockResolvedValue({ ...registration, status: 'RESULT_FAIL' });
      prisma.user.findFirst.mockResolvedValue({ id: 'u-other' });
      await service.recordResult(adminCaller, 'reg-1', {
        status: 'RESULT_FAIL',
        examinerId: 'u-other',
      });
      expect(prisma.examRegistration.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RESULT_FAIL', examinerId: 'u-other' }),
        }),
      );
      expect(prisma.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'u-other' }) }),
      );
    });
  });

  describe('create and update', () => {
    it('validates the target rank and the deadline order', async () => {
      prisma.beltRank.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          title: 'Grading',
          examDate: '2026-03-20',
          targetRankId: 99,
          feeAmount: 1,
          registrationDeadline: '2026-03-01',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      prisma.beltRank.findUnique.mockResolvedValue({ id: 4 });
      prisma.beltExam.findFirst.mockResolvedValue(null);
      prisma.beltExam.findUnique.mockResolvedValue(null);
      await expect(
        service.create({
          title: 'Grading',
          examDate: '2026-03-20',
          targetRankId: 4,
          feeAmount: 1,
          registrationDeadline: '2026-03-25',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.beltExam.create.mockResolvedValue(exam);
      await expect(
        service.create({
          title: 'Grading',
          examDate: '2026-03-20',
          targetRankId: 4,
          feeAmount: 1,
          registrationDeadline: '2026-03-01',
        }),
      ).resolves.toMatchObject({ code: 'EXAM-2026-03' });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'belt_exam_created', success: true }),
      );
    });

    it('404s unknown exams on update and audits successful patches', async () => {
      prisma.beltExam.findUnique.mockResolvedValue(null);
      await expect(service.update('missing', { title: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.beltExam.findUnique.mockResolvedValue(exam);
      prisma.beltExam.update.mockResolvedValue({ ...exam, status: 'OPEN' });
      await expect(service.update('exam-1', { status: 'OPEN' })).resolves.toMatchObject({
        status: 'OPEN',
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'belt_exam_updated', success: true }),
      );
    });
  });
});
