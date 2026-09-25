import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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
      groupBy: jest.fn(),
    },
    invoiceItem: { create: jest.fn(), createMany: jest.fn() },
    studentProfile: { findFirst: jest.fn() },
    parentStudentLink: { findMany: jest.fn(), findFirst: jest.fn() },
    appSetting: { findUnique: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    enrollment: { findMany: jest.fn() },
    paymentTransaction: { findMany: jest.fn(), aggregate: jest.fn() },
    class: { count: jest.fn() },
    discountCode: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
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
  const outbox = {
    enqueue: jest.fn().mockResolvedValue({ id: 'notif-email' }),
    enqueueInApp: jest.fn().mockResolvedValue({ id: 'notif-inapp' }),
  };
  const service = new BillingService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    outbox as never,
  );
  return { service, auditRecord: audit.record as jest.Mock, outbox };
}

describe('BillingService', () => {
  let prisma: PrismaMock;
  let service: BillingService;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, auditRecord } = makeService(prisma));
    prisma.invoice.findMany.mockResolvedValue([{ invoiceNo: 'INV-2026-0007' }]);
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

    it('writes outbox rows atomically for students with an account (plan 7.6)', async () => {
      prisma.studentProfile.findFirst.mockResolvedValue({
        id: 'sp-1',
        status: 'ACTIVE',
        user: { id: 'u-student', email: 'student@example.com' },
      });
      prisma.invoice.create.mockResolvedValue({ ...invoice, total: 250000 });
      const { service: hooked, outbox } = makeService(prisma);
      await hooked.create(admin, dto);
      expect(outbox.enqueueInApp).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ userId: 'u-student', templateCode: 'invoice_issued' }),
      );
      expect(outbox.enqueue).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          userId: 'u-student',
          channel: 'EMAIL',
          payload: expect.objectContaining({ email: 'student@example.com' }),
        }),
      );
    });

    it('skips notifications for profiles without a user account (no-account minors)', async () => {
      prisma.studentProfile.findFirst.mockResolvedValue({
        id: 'sp-1',
        status: 'ACTIVE',
        user: null,
      });
      prisma.invoice.create.mockResolvedValue({ ...invoice, total: 250000 });
      const { service: hooked, outbox } = makeService(prisma);
      await hooked.create(admin, dto);
      expect(outbox.enqueueInApp).not.toHaveBeenCalled();
      expect(outbox.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('generateMonthly (plan 7.7)', () => {
    const dto = { month: 10, year: 2026, classIds: ['class-1', 'class-2'] };
    const enrollment = (studentId: string, classId: string, className: string) => ({
      studentId,
      classId,
      class: { name: className },
    });

    it('creates one invoice per student with a line item per class', async () => {
      prisma.appSetting.findUnique.mockResolvedValue({
        key: 'tuition_rates',
        value: { 'class-1': 500000 },
      });
      prisma.enrollment.findMany.mockResolvedValue([enrollment('sp-1', 'class-1', 'White Belt A')]);
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

    it('aggregates a multi-class student into ONE invoice whose items sum both rates', async () => {
      prisma.appSetting.findUnique.mockResolvedValue({
        key: 'tuition_rates',
        value: { 'class-1': 500000, 'class-2': 400000 },
      });
      prisma.enrollment.findMany.mockResolvedValue([
        enrollment('sp-1', 'class-1', 'White Belt A'),
        enrollment('sp-1', 'class-2', 'White Belt B'),
      ]);
      prisma.invoice.create.mockResolvedValue({ ...invoice });

      const result = await service.generateMonthly(admin, dto);
      expect(result).toMatchObject({ created: 1, skippedExisting: 0 });
      const data = prisma.invoice.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ total: 900000 });
      // createMany carries one item per class so no rate is lost to the UQ.
      expect(prisma.invoiceItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            amount: 500000,
            description: expect.stringContaining('White Belt A'),
          }),
          expect.objectContaining({
            amount: 400000,
            description: expect.stringContaining('White Belt B'),
          }),
        ],
      });
    });

    it('counts a duplicate period invoice as skipped instead of failing (idempotent)', async () => {
      prisma.appSetting.findUnique.mockResolvedValue({
        key: 'tuition_rates',
        value: { 'class-1': 500000 },
      });
      prisma.enrollment.findMany.mockResolvedValue([enrollment('sp-1', 'class-1', 'White Belt A')]);
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

  describe('admin settings (matrix row 29)', () => {
    it('reads the two business keys with safe defaults', async () => {
      prisma.appSetting.findMany.mockResolvedValue([
        { key: 'tuition_rates', value: { 'c-1': 400000 } },
      ]);
      await expect(service.getSettings()).resolves.toMatchObject({
        tuitionRates: { 'c-1': 400000 },
        bankAccount: null,
      });
    });

    it('replaces tuition rates and rejects unknown or duplicated class ids', async () => {
      prisma.appSetting.findMany.mockResolvedValue([]);
      prisma.appSetting.upsert.mockResolvedValue({});
      prisma.class.count.mockResolvedValue(1);
      await service.updateTuitionRates(admin, [{ classId: 'c-1', monthlyAmount: 450000 }]);
      expect(prisma.appSetting.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { key: 'tuition_rates' } }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'settings_updated' }),
      );

      prisma.class.count.mockResolvedValue(0);
      await expect(
        service.updateTuitionRates(admin, [{ classId: 'nope', monthlyAmount: 1 }]),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.updateTuitionRates(admin, [
          { classId: 'c-1', monthlyAmount: 1 },
          { classId: 'c-1', monthlyAmount: 2 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stores the bank account in the exact shape the QR guard reads', async () => {
      prisma.appSetting.findMany.mockResolvedValue([]);
      prisma.appSetting.upsert.mockResolvedValue({});
      await service.updateBankAccount(admin, {
        bin: '970422',
        number: '0071000123456',
        name: 'CLB VOVINAM',
        ownerType: 'BUSINESS',
      });
      const call = prisma.appSetting.upsert.mock.calls[0]?.[0] as {
        update: { value: Record<string, string> };
      };
      expect(call.update.value).toMatchObject({ owner_type: 'BUSINESS' });
    });
  });

  describe('tuition report (matrix row 27)', () => {
    it('aggregates status totals and collected amounts for one period', async () => {
      prisma.invoice.groupBy.mockResolvedValue([
        { status: 'UNPAID', _count: { _all: 2 }, _sum: { total: 800000 } },
        { status: 'PAID', _count: { _all: 1 }, _sum: { total: 400000 } },
      ]);
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amount: 400000 } });
      await expect(service.tuitionReport(9, 2026)).resolves.toMatchObject({
        month: 9,
        year: 2026,
        collectedVnd: 400000,
      });
      expect(prisma.invoice.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['status'],
          where: expect.objectContaining({ type: 'TUITION' }),
        }),
      );
    });
  });

  describe('discount codes (matrix row 23)', () => {
    const codeRow = {
      id: 'd-1',
      code: 'E2E10',
      description: '10% off',
      percentOff: 10,
      amountOff: null,
      validFrom: new Date('2026-01-01'),
      validUntil: new Date('2030-01-01'),
      isActive: true,
    };

    it('creates a code and enforces the percent/amount XOR plus the window order', async () => {
      prisma.discountCode.create.mockResolvedValue(codeRow);
      await service.createDiscountCode(admin, {
        code: 'e2e10',
        percentOff: 10,
        validFrom: new Date('2026-01-01'),
        validUntil: new Date('2030-01-01'),
      });
      expect(prisma.discountCode.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ code: 'E2E10' }),
      });

      await expect(
        service.createDiscountCode(admin, {
          code: 'BOTH',
          percentOff: 10,
          amountOff: 50000,
          validFrom: new Date('2026-01-01'),
          validUntil: new Date('2030-01-01'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createDiscountCode(admin, {
          code: 'NEITHER',
          validFrom: new Date('2026-01-01'),
          validUntil: new Date('2030-01-01'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createDiscountCode(admin, {
          code: 'BACKWARDS',
          percentOff: 10,
          validFrom: new Date('2030-01-01'),
          validUntil: new Date('2026-01-01'),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('maps a duplicate code to 409 and 404s unknown ids on update/delete', async () => {
      prisma.discountCode.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: '6.12.0',
        }),
      );
      await expect(
        service.createDiscountCode(admin, {
          code: 'E2E10',
          percentOff: 10,
          validFrom: new Date('2026-01-01'),
          validUntil: new Date('2030-01-01'),
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      prisma.discountCode.findUnique.mockResolvedValue(null);
      await expect(
        service.updateDiscountCode(admin, 'nope', { isActive: false }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.deleteDiscountCode(admin, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('applies an active percent code at invoice creation and rejects unusable codes', async () => {
      prisma.studentProfile.findFirst.mockResolvedValue({
        id: 'sp-1',
        status: 'ACTIVE',
        user: null,
      });
      prisma.invoice.findMany.mockResolvedValue([{ invoiceNo: 'INV-2026-0009' }]);
      prisma.invoice.create.mockResolvedValue({ ...invoice, invoiceNo: 'INV-2026-0009' });
      prisma.discountCode.findUnique.mockResolvedValue(codeRow);

      await service.create(admin, {
        studentId: 'sp-1',
        type: 'UNIFORM',
        items: [{ description: 'Uniform', quantity: 1, unitAmount: 500000 }],
        discountCode: 'e2e10',
      });
      const created = prisma.invoice.create.mock.calls.at(-1)?.[0] as {
        data: { discount: number };
      };
      expect(created.data.discount).toBe(50000);

      prisma.discountCode.findUnique.mockResolvedValue({ ...codeRow, isActive: false });
      await expect(
        service.create(admin, {
          studentId: 'sp-1',
          type: 'OTHER',
          items: [{ description: 'X', quantity: 1, unitAmount: 100000 }],
          discountCode: 'E2E10',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      prisma.discountCode.findUnique.mockResolvedValue(null);
      await expect(
        service.create(admin, {
          studentId: 'sp-1',
          type: 'OTHER',
          items: [{ description: 'X', quantity: 1, unitAmount: 100000 }],
          discountCode: 'GHOST',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
