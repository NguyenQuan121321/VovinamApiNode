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
    $queryRaw: jest.fn().mockResolvedValue([]),
    beltExam: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    beltRank: { findUnique: jest.fn(), findMany: jest.fn() },
    studentProfile: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    examRegistration: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
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

    it('locks the exam row before the capacity check (DB baseline §12 race fix)', async () => {
      await service.register(studentCaller, 'exam-1', { studentId: 'sp-1' });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = (prisma.$queryRaw.mock.calls[0]?.[0] as string[]).join('');
      expect(sql).toContain('FROM "belt_exams"');
      expect(sql).toContain('FOR UPDATE');
      // The lock precedes the capacity count that serialization guarantees.
      expect(Math.min(...prisma.$queryRaw.mock.invocationCallOrder)).toBeLessThan(
        Math.min(...prisma.examRegistration.count.mock.invocationCallOrder),
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
      prisma.studentProfile.findUnique.mockResolvedValue({ currentBeltRankId: null });
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

    it('promotes when the student holds a lower rank at result time', async () => {
      prisma.examRegistration.findUnique.mockResolvedValue(registration);
      prisma.studentProfile.findUnique.mockResolvedValue({ currentBeltRankId: 3 });
      prisma.beltRank.findMany.mockResolvedValue([
        { id: 3, orderIndex: 7 },
        { id: 4, orderIndex: 10 },
      ]);
      prisma.examRegistration.update.mockResolvedValue({ ...registration, status: 'RESULT_PASS' });
      await service.recordResult(instructorCaller, 'reg-1', { status: 'RESULT_PASS' });
      expect(prisma.studentProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { currentBeltRankId: 4 } }),
      );
    });

    it('refuses a stale PASS that would downgrade the rank (G-2, DB baseline §12)', async () => {
      // The student was promoted by another exam after this registration was
      // created; recording its PASS must not move the belt down.
      prisma.examRegistration.findUnique.mockResolvedValue(registration);
      prisma.studentProfile.findUnique.mockResolvedValue({ currentBeltRankId: 6 });
      prisma.beltRank.findMany.mockResolvedValue([
        { id: 6, orderIndex: 16 },
        { id: 4, orderIndex: 10 },
      ]);
      await expect(
        service.recordResult(instructorCaller, 'reg-1', { status: 'RESULT_PASS' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.studentProfile.update).not.toHaveBeenCalled();
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

      prisma.beltRank.findUnique.mockResolvedValue({ id: 4, isActive: false });
      await expect(
        service.create({
          title: 'Grading',
          examDate: '2026-03-20',
          targetRankId: 4,
          feeAmount: 1,
          registrationDeadline: '2026-03-01',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.beltRank.findUnique.mockResolvedValue({ id: 4, isActive: true });
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

  describe('listStudentRegistrations (belt history, matrix row 17)', () => {
    it('enforces the ownership guard and returns the scoped timeline', async () => {
      prisma.examRegistration.count.mockResolvedValue(1);
      prisma.examRegistration.findMany.mockResolvedValue([
        {
          id: 'reg-1',
          studentId: 'sp-1',
          status: 'RESULT_PASS',
          resultNote: 'Well done',
          updatedAt: new Date('2026-09-01T00:00:00Z'),
          exam: {
            id: 'e-1',
            code: 'EXAM-2026-1',
            title: 'Dot 1',
            examDate: new Date('2026-09-01'),
          },
          targetRank: { code: 'VANG_1', name: 'Yellow 1', orderIndex: 4 },
          currentRank: { code: 'LAM_1', name: 'Blue 1', orderIndex: 1 },
        },
      ]);
      const result = await service.listStudentRegistrations(studentCaller, 'sp-1', {
        studentId: 'sp-1',
        page: 1,
        limit: 20,
      });
      expect(ownership.assertCanAccess).toHaveBeenCalledWith(studentCaller, 'sp-1');
      expect(result).toMatchObject({ total: 1, page: 1, limit: 20 });
      const item = (result.items as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
      expect(item).toMatchObject({ status: 'RESULT_PASS' });
      expect(item.exam).toMatchObject({ code: 'EXAM-2026-1' });
    });

    it('answers 404 through the guard for a foreign student', async () => {
      ownership.assertCanAccess.mockRejectedValueOnce(new NotFoundException('Not found'));
      await expect(
        service.listStudentRegistrations(studentCaller, 'foreign', {
          studentId: 'foreign',
          page: 1,
          limit: 20,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
