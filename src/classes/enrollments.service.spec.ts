import { ConflictException, NotFoundException } from '@nestjs/common';
import { EnrollmentsService } from './enrollments.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

const cls = {
  id: 'class-1',
  name: 'White Belt A',
  instructorId: 'inst-1',
  location: null,
  capacity: 2,
  status: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const profile = {
  id: 'sp-1',
  userId: null,
  fullName: 'Tran Thi C',
  dob: new Date('2013-01-01'),
  gender: 'FEMALE',
  phone: null,
  address: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  medicalNotes: null,
  currentBeltRankId: null,
  inviteCode: 'ABCD2345',
  joinedAt: new Date(),
  status: 'ACTIVE',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const createdEnrollment = {
  id: 'e-1',
  studentId: 'sp-1',
  classId: 'class-1',
  enrolledAt: new Date(),
  leftAt: null,
  student: profile,
  class: { name: 'White Belt A', status: 'ACTIVE' },
};

function makePrismaMock() {
  const tx = {
    class: { findUnique: jest.fn() },
    studentProfile: { findFirst: jest.fn() },
    enrollment: { findFirst: jest.fn(), count: jest.fn(), create: jest.fn() },
  };
  const prisma = {
    enrollment: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  return { prisma, tx };
}

type PrismaMock = ReturnType<typeof makePrismaMock>['prisma'];
type TxMock = ReturnType<typeof makePrismaMock>['tx'];

function makeService(prisma: PrismaMock, tx: TxMock) {
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg as Promise<unknown>[])
      : (arg as (tx: unknown) => unknown)(tx),
  );
  const audit = { record: jest.fn() };
  return {
    service: new EnrollmentsService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    ),
    auditRecord: audit.record as jest.Mock,
  };
}

describe('EnrollmentsService', () => {
  let prisma: PrismaMock;
  let tx: TxMock;
  let service: EnrollmentsService;
  let auditRecord: jest.Mock;

  const dto = { studentId: 'sp-1', classId: 'class-1' };

  beforeEach(() => {
    ({ prisma, tx } = makePrismaMock());
    ({ service, auditRecord } = makeService(prisma, tx));
    tx.class.findUnique.mockResolvedValue(cls);
    tx.studentProfile.findFirst.mockResolvedValue(profile);
    tx.enrollment.findFirst.mockResolvedValue(null);
    tx.enrollment.count.mockResolvedValue(0);
    tx.enrollment.create.mockResolvedValue(createdEnrollment);
  });

  it('enrolls an active student into an active class', async () => {
    await expect(service.create(dto)).resolves.toMatchObject({
      id: 'e-1',
      className: 'White Belt A',
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'enrollment_created', success: true }),
    );
  });

  it('rejects unknown classes and students with a uniform 404', async () => {
    tx.class.findUnique.mockResolvedValue(null);
    await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);

    tx.class.findUnique.mockResolvedValue(cls);
    tx.studentProfile.findFirst.mockResolvedValue(null);
    await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects inactive classes and pending profiles with 409', async () => {
    tx.class.findUnique.mockResolvedValue({ ...cls, status: 'ARCHIVED' });
    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);

    tx.class.findUnique.mockResolvedValue(cls);
    tx.studentProfile.findFirst.mockResolvedValue({ ...profile, status: 'PENDING' });
    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks duplicate open enrollments and same-day re-enrollment (plan section 6 UQ)', async () => {
    tx.enrollment.findFirst
      .mockResolvedValueOnce({ id: 'open' }) // open enrollment exists
      .mockResolvedValue(null);
    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);

    // No open enrollment, but one created earlier today: still blocked.
    tx.enrollment.findFirst
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'left-today' });
    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('enforces class capacity over open enrollments', async () => {
    tx.enrollment.count.mockResolvedValue(2); // capacity 2
    await expect(service.create(dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('soft-leaves an enrollment and 404s unknown or already-left ones', async () => {
    prisma.enrollment.findFirst.mockResolvedValue({ id: 'e-1' });
    prisma.enrollment.update.mockResolvedValue({ ...createdEnrollment, leftAt: new Date() });
    await expect(service.remove('e-1')).resolves.toEqual({ left: true });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'enrollment_removed', success: true }),
    );

    prisma.enrollment.findFirst.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists enrollments paginated with student and class context', async () => {
    prisma.enrollment.findMany.mockResolvedValue([createdEnrollment]);
    prisma.enrollment.count.mockResolvedValue(1);
    const page = await service.list({ page: 1, limit: 20 });
    expect(page).toMatchObject({ total: 1 });
    expect(page.items[0]).toMatchObject({
      id: 'e-1',
      className: 'White Belt A',
      student: { fullName: 'Tran Thi C' },
    });
  });
});
