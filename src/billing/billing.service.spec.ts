import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BillingService, type Tx } from './billing.service';
import { AuditService } from '../auth/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

const admin = { id: 'admin-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as AuthenticatedUser;
const student = {
  id: 'u-student',
  role: 'STUDENT',
  sessionId: 's',
  jti: 'j',
} as AuthenticatedUser;
const parent = { id: 'u-parent', role: 'PARENT', sessionId: 's', jti: 'j' } as AuthenticatedUser;

const invoice = {
  id: 'inv-1',
  invoiceNo: 'INV-2026-0001',
  studentId: 'sp-1',
  type: 'TUITION',
  periodMonth: 9,
  periodYear: 2026,
  subtotal: 500000,
  discount: 0,
  total: 500000,
  status: 'UNPAID',
  dueDate: new Date('2026-09-10'),
  issuedAt: new Date(),
  note: null,
  createdBy: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  items: [],
};

const exam = {
  code: 'EXAM-2026-03',
  title: 'Mid-term grading',
  feeAmount: 300000,
  examDate: new Date('2026-03-20'),
};

function makePrismaMock() {
  return {
    invoice: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    invoiceItem: { create: jest.fn(), createMany: jest.fn() },
    studentProfile: { findFirst: jest.fn() },
    parentStudentLink: { findMany: jest.fn(), findFirst: jest.fn() },
    appSetting: { findUnique: jest.fn() },
    enrollment: { findMany: jest.fn() },
    paymentTransaction: { findMany: jest.fn(), aggregate: jest.fn() },
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
  const service = new BillingService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, auditRecord: audit.record as jest.Mock };
}

describe('BillingService', () => {
  let prisma: PrismaMock;
  let service: BillingService;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, auditRecord } = makeService(prisma));
    prisma.invoice.findFirst.mockResolvedValue({ invoiceNo: 'INV-2026-0007' });
    prisma.invoice.create.mockImplementation(
      ({ data }: { data: { invoiceNo: string; total: number } }) =>
        Promise.resolve({
          ...invoice,
          invoiceNo: data.invoiceNo,
          total: data.total,
          status: 'UNPAID',
        }),
    );
  });

  describe('exam fee invoices (P3 flow, unchanged)', () => {
    it('issues a sequential invoice with one correct line item', async () => {
      const tx = prisma as unknown as Tx;
      const created = await service.createExamFeeInvoice(tx, {
        studentId: 'sp-1',
        exam,
        examRegistrationId: 'reg-1',
        createdBy: 'admin-1',
      });
      expect(created).toMatchObject({
        invoiceNo: 'INV-2026-0008',
        total: 300000,
        status: 'UNPAID',
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'invoice_issued', success: true }),
      );
    });

    it('retries on a conflicting invoice_no and then succeeds', async () => {
      prisma.invoice.create
        .mockRejectedValueOnce(
          new Prisma.PrismaClientKnownRequestError('duplicate', {
            code: 'P2002',
            clientVersion: '6.12.0',
            meta: { target: ['invoice_no'] },
          }),
        )
        .mockResolvedValueOnce({
          id: 'inv-2',
          invoiceNo: 'INV-2026-0003',
          total: 5,
          status: 'UNPAID',
        });
      const created = await service.createExamFeeInvoice(prisma as unknown as Tx, {
        studentId: 'sp-1',
        exam,
        examRegistrationId: 'reg-1',
        createdBy: 'admin-1',
      });
      expect(created.invoiceNo).toBe('INV-2026-0003');
      expect(prisma.invoice.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('list and detail (plan 7.4 scoping)', () => {
    it('admin sees everything, students only their own, parents only linked children', async () => {
      prisma.invoice.findMany.mockResolvedValue([invoice]);
      prisma.invoice.count.mockResolvedValue(1);

      await service.list(admin, { page: 1, limit: 20 });
      expect(prisma.invoice.findMany.mock.calls[0][0].where).toEqual({});

      prisma.studentProfile.findFirst.mockResolvedValue({ id: 'sp-1' });
      await service.list(student, { page: 1, limit: 20 });
      expect(prisma.invoice.findMany.mock.calls[1][0].where).toMatchObject({ studentId: 'sp-1' });

      prisma.studentProfile.findFirst.mockResolvedValue(null);
      await service.list(student, { page: 1, limit: 20 });
      expect(prisma.invoice.findMany.mock.calls[2][0].where).toMatchObject({
        studentId: 'no-profile',
      });

      prisma.parentStudentLink.findMany.mockResolvedValue([
        { studentId: 'sp-1' },
        { studentId: 'sp-2' },
      ]);
      await service.list(parent, { page: 1, limit: 20 });
      expect(prisma.invoice.findMany.mock.calls[3][0].where).toMatchObject({
        studentId: { in: ['sp-1', 'sp-2'] },
      });
    });

    it('guards detail through ownership and includes the items', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, items: [{ id: 'it-1' }] });
      prisma.studentProfile.findFirst.mockResolvedValue({ id: 'sp-1' });
      const detail = await service.getById(student, 'inv-1');
      expect(detail).toMatchObject({ invoiceNo: 'INV-2026-0001' });
      expect(Array.isArray(detail.items)).toBe(true);

      prisma.studentProfile.findFirst.mockResolvedValue(null);
      await expect(service.getById(student, 'inv-1')).rejects.toBeInstanceOf(NotFoundException);

      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(service.getById(student, 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('answers 404 for instructors (plan 7.4) and parents via verified links (plan 7.3)', async () => {
      const instructor = {
        id: 'u-inst',
        role: 'INSTRUCTOR',
        sessionId: 's',
        jti: 'j',
      } as AuthenticatedUser;
      prisma.invoice.findUnique.mockResolvedValue(invoice);
      await expect(service.getById(instructor, 'inv-1')).rejects.toBeInstanceOf(NotFoundException);

      const linkedParent = {
        id: 'u-parent',
        role: 'PARENT',
        sessionId: 's',
        jti: 'j',
      } as AuthenticatedUser;
      prisma.parentStudentLink.findFirst.mockResolvedValue({ id: 'link-1' });
      await expect(service.getById(linkedParent, 'inv-1')).resolves.toBeDefined();

      prisma.parentStudentLink.findFirst.mockResolvedValue(null);
      await expect(service.getById(linkedParent, 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create (admin manual invoice)', () => {
    const dto = {
      studentId: 'sp-1',
      type: 'UNIFORM' as const,
      items: [{ description: 'Uniform', quantity: 2, unitAmount: 150000 }],
      discount: 50000,
    };

    it('computes totals, requires a period for tuition, and caps discounts', async () => {
      prisma.studentProfile.findFirst.mockResolvedValue({ id: 'sp-1', status: 'ACTIVE' });
      await expect(service.create(admin, { ...dto, type: 'TUITION' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(
        service.create(admin, { ...dto, periodMonth: 9, periodYear: 2026 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create(admin, { ...dto, discount: 999999999 })).rejects.toBeInstanceOf(
        BadRequestException,
      );

      prisma.invoice.create.mockResolvedValue({ ...invoice, total: 250000 });
      const created = await service.create(admin, dto);
      expect(created).toMatchObject({ total: 250000 });
      const data = prisma.invoice.create.mock.calls.at(-1)?.[0].data;
      expect(data).toMatchObject({ subtotal: 300000, discount: 50000, total: 250000 });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'invoice_created', success: true }),
      );
    });

    it('404s unknown students', async () => {
      prisma.studentProfile.findFirst.mockResolvedValue(null);
      await expect(service.create(admin, dto)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('generateMonthly (plan 7.7)', () => {
    const dto = { month: 10, year: 2026, classIds: ['class-1', 'class-2'] };

    it('creates one invoice per active enrollment at the configured rate', async () => {
      prisma.appSetting.findUnique.mockResolvedValue({
        key: 'tuition_rates',
        value: { 'class-1': 500000 },
      });
      prisma.enrollment.findMany.mockResolvedValue([{ studentId: 'sp-1', classId: 'class-1' }]);
      prisma.invoice.create.mockResolvedValue({ ...invoice });

      const result = await service.generateMonthly(admin, dto);
      expect(result).toMatchObject({ created: 1, skippedExisting: 0 });
      expect(result.classesSkipped).toEqual([
        { classId: 'class-2', reason: 'no tuition rate configured' },
      ]);
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        type: 'TUITION',
        periodMonth: 10,
        periodYear: 2026,
        total: 500000,
      });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'tuition_generated', success: true }),
      );
    });

    it('counts a duplicate period invoice as skipped instead of failing (idempotent)', async () => {
      prisma.appSetting.findUnique.mockResolvedValue({
        key: 'tuition_rates',
        value: { 'class-1': 500000 },
      });
      prisma.enrollment.findMany.mockResolvedValue([{ studentId: 'sp-1', classId: 'class-1' }]);
      prisma.invoice.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.12.0',
          meta: { target: ['student_id', 'type', 'period_month', 'period_year'] },
        }),
      );
      const result = await service.generateMonthly(admin, dto);
      expect(result).toMatchObject({ created: 0, skippedExisting: 1 });
    });
  });

  describe('revenue (plan 8)', () => {
    it('buckets SUCCESS payments by month and gateway', async () => {
      prisma.paymentTransaction.findMany.mockResolvedValue([
        { amount: 500000, gateway: 'BANK_TRANSFER', paidAt: new Date('2026-10-05') },
        { amount: 200000, gateway: 'CASH', paidAt: new Date('2026-10-20') },
        { amount: 100000, gateway: 'BANK_TRANSFER', paidAt: new Date('2026-11-01') },
        { amount: 999, gateway: 'CASH', paidAt: new Date('2026-12-31') },
      ]);
      const result = await service.revenue(admin, new Date('2026-10-01'), new Date('2026-12-31'));
      const rows = result.rows as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(4);
      expect(result).toMatchObject({ grandTotal: 800999 });
      expect(rows[0]).toMatchObject({ month: '2026-10', gateway: 'BANK_TRANSFER', total: 500000 });

      // A SUCCESS payment without paid_at falls back to the epoch bucket defensively.
      prisma.paymentTransaction.findMany.mockResolvedValue([
        { amount: 777, gateway: 'CASH', paidAt: null },
      ]);
      await expect(
        service.revenue(admin, new Date('2026-10-01'), new Date('2026-12-31')),
      ).resolves.toMatchObject({ grandTotal: 777 });
    });
  });
});
