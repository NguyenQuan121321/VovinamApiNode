import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { NotificationOutboxService } from '../notifications/notification-outbox.service';
import { nextSequentialCode } from './sequential-code';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type { CreateInvoiceDto, GenerateMonthlyDto, ListInvoicesQueryDto } from './dto/billing.dto';
import type { CreateDiscountCodeDto, UpdateDiscountCodeDto } from './dto/settings.dto';

/** Minimal transaction handle the invoice methods need (works with PrismaService or a tx client). */
export type Tx = Pick<Prisma.TransactionClient, 'invoice' | 'invoiceItem'>;

interface ExamFeeInvoiceArgs {
  studentId: string;
  exam: { code: string; title: string; feeAmount: number; examDate: Date };
  examRegistrationId: string;
  createdBy: string;
}

/**
 * Invoices (plan sections 6, 7.5, 7.7, 8). Invoices are never hard-deleted and
 * payment_transactions reference them with ON DELETE RESTRICT, so the chain
 * stays intact (plan 7.2, 10). Monthly tuition generation is idempotent through
 * the (student, type, period_month, period_year) unique constraint.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  /**
   * Issues the single-line EXAM_FEE invoice for one exam registration inside the
   * caller's transaction, so registration + invoice commit atomically.
   */
  async createExamFeeInvoice(
    tx: Tx,
    args: ExamFeeInvoiceArgs,
  ): Promise<{ id: string; invoiceNo: string; total: number; status: string }> {
    const year = new Date().getUTCFullYear();
    // A concurrent issuer computing the same invoice_no loses to the unique
    // constraint and retries with a bounded number of attempts (plan 9).
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const invoiceNo = await this.nextInvoiceNo(tx, year);
      try {
        const invoice = await tx.invoice.create({
          data: {
            invoiceNo,
            studentId: args.studentId,
            type: 'EXAM_FEE',
            refExamRegistrationId: args.examRegistrationId,
            subtotal: args.exam.feeAmount,
            discount: 0,
            total: args.exam.feeAmount,
            status: 'UNPAID',
            dueDate: args.exam.examDate,
            note: `Belt exam ${args.exam.code} (${args.exam.title})`,
            createdBy: args.createdBy,
          },
        });
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            description: `Belt exam fee ${args.exam.code} — ${args.exam.title}`,
            quantity: 1,
            unitAmount: args.exam.feeAmount,
            amount: args.exam.feeAmount,
          },
        });
        this.audit.record({
          event: 'invoice_issued',
          success: true,
          detail: `invoice:${invoice.id} exam_registration:${args.examRegistrationId}`,
        });
        return {
          id: invoice.id,
          invoiceNo: invoice.invoiceNo,
          total: invoice.total,
          status: invoice.status,
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < 4
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('unreachable');
  }

  /** Sequential INV-<year>-<NNNN>, guarded by the unique constraint (plan 9). */
  async nextInvoiceNo(tx: Tx, year: number): Promise<string> {
    const prefix = `INV-${year}-`;
    const rows = await tx.invoice.findMany({
      where: { invoiceNo: { startsWith: prefix } },
      select: { invoiceNo: true },
    });
    return nextSequentialCode(
      prefix,
      rows.map((row) => row.invoiceNo),
      4,
    );
  }

  /**
   * Role-scoped invoice list (plan 8 + serializer 7.4): ADMIN sees everything,
   * STUDENT their own invoices, PARENT the verified children's; INSTRUCTOR gets
   * none (blocked at the roles guard).
   */
  async list(
    caller: AuthenticatedUser,
    query: ListInvoicesQueryDto,
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
  }> {
    const where: Prisma.InvoiceWhereInput = {
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.type === undefined ? {} : { type: query.type }),
    };
    if (caller.role === 'STUDENT') {
      const profile = await this.prisma.studentProfile.findFirst({
        where: { userId: caller.id, deletedAt: null },
        select: { id: true },
      });
      where.studentId = profile?.id ?? 'no-profile';
    } else if (caller.role === 'PARENT') {
      const links = await this.prisma.parentStudentLink.findMany({
        where: { parentUserId: caller.id, verified: true },
        select: { studentId: true },
      });
      where.studentId = { in: links.map((l) => l.studentId) };
    } else if (query.studentId !== undefined) {
      where.studentId = query.studentId;
    }
    const [invoices, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      items: invoices.map((invoice) => this.serializeInvoice(invoice)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Invoice detail with line items, guarded by plan 7.3 for every role. */
  async getById(caller: AuthenticatedUser, invoiceId: string): Promise<Record<string, unknown>> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: true },
    });
    if (invoice === null) {
      throw new NotFoundException('Not found');
    }
    await this.assertInvoiceAccess(caller, invoice.studentId);
    return this.serializeInvoice(invoice, true);
  }

  /** ADMIN manual invoice (uniform fees, penalties, ...). */
  async create(caller: AuthenticatedUser, dto: CreateInvoiceDto): Promise<Record<string, unknown>> {
    const profile = await this.prisma.studentProfile.findFirst({
      where: { id: dto.studentId, deletedAt: null },
      // The user relation is needed to notify the student (plan 7.6 outbox hook).
      select: { id: true, status: true, user: { select: { id: true, email: true } } },
    });
    if (profile === null) {
      throw new NotFoundException('Not found');
    }
    if (dto.type === 'TUITION') {
      if (dto.periodMonth === undefined || dto.periodYear === undefined) {
        throw new BadRequestException('Tuition invoices need a billing period');
      }
    } else if (dto.periodMonth !== undefined || dto.periodYear !== undefined) {
      throw new BadRequestException('Only tuition invoices carry a billing period');
    }
    const subtotal = dto.items.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0);
    let discount = dto.discount ?? 0;
    let appliedCode: string | null = null;
    if (dto.discountCode !== undefined && dto.discountCode !== '') {
      const codeDiscount = await this.resolveDiscountCode(dto.discountCode, subtotal);
      discount += codeDiscount;
      appliedCode = dto.discountCode.toUpperCase();
    }
    if (discount > subtotal) {
      throw new BadRequestException('Discount cannot exceed the subtotal');
    }
    const dueDate = dto.dueDate === undefined ? this.defaultDueDate() : new Date(dto.dueDate);
    // Bounded retry: a concurrent issuer computing the same invoice_no loses to
    // the unique constraint and re-derives the sequence (plan 9).
    let created!: Invoice;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.create({
            data: {
              invoiceNo: await this.nextInvoiceNo(tx, new Date().getUTCFullYear()),
              studentId: dto.studentId,
              type: dto.type,
              periodMonth: dto.periodMonth,
              periodYear: dto.periodYear,
              subtotal,
              discount,
              total: subtotal - discount,
              status: 'UNPAID',
              dueDate,
              note: dto.note,
              createdBy: caller.id,
            },
          });
          await tx.invoiceItem.createMany({
            data: dto.items.map((item) => ({
              invoiceId: invoice.id,
              description: item.description,
              quantity: item.quantity,
              unitAmount: item.unitAmount,
              amount: item.quantity * item.unitAmount,
            })),
          });
          // Outbox rows commit with the invoice in ONE transaction (plan 7.6): the
          // notification exists exactly when the invoice exists, never before or after.
          if (profile.user) {
            const summary = `Invoice ${invoice.invoiceNo} (${dto.type}) issued — total ${invoice.total} VND, due ${dueDate.toISOString().slice(0, 10)}`;
            await this.outbox.enqueueInApp(tx, {
              userId: profile.user.id,
              templateCode: 'invoice_issued',
              payload: { message: summary },
            });
            await this.outbox.enqueue(tx, {
              userId: profile.user.id,
              channel: 'EMAIL',
              templateCode: 'invoice_issued',
              payload: { message: summary, email: profile.user.email },
            });
          }
          return invoice;
        });
        break;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          attempt < 4
        ) {
          continue;
        }
        throw error;
      }
    }
    this.audit.record({
      event: 'invoice_created',
      success: true,
      detail: `invoice:${created.id} student:${dto.studentId}${appliedCode === null ? '' : ` discount_code:${appliedCode}`}`,
    });
    return this.serializeInvoice(created, true);
  }

  /**
   * Monthly tuition close (plan 7.7): one TUITION invoice per (student, class)
   * for the period, rate from app_settings.tuition_rates keyed by class id.
   * Idempotent through the invoice period unique constraint (plan 9).
   */
  async generateMonthly(
    caller: AuthenticatedUser,
    dto: GenerateMonthlyDto,
  ): Promise<Record<string, unknown>> {
    const ratesSetting = await this.prisma.appSetting.findUnique({
      where: { key: 'tuition_rates' },
    });
    const rates = (ratesSetting?.value ?? {}) as Record<string, unknown>;
    const monthEnd = new Date(Date.UTC(dto.year, dto.month, 1));
    const dueDate = new Date(Date.UTC(dto.year, dto.month - 1, 10));

    const classesSkipped: Array<{ classId: string; reason: string }> = [];
    const rateByClass = new Map<string, number>();
    for (const classId of dto.classIds) {
      const rate = rates[classId];
      if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
        classesSkipped.push({ classId, reason: 'no tuition rate configured' });
        continue;
      }
      rateByClass.set(classId, rate);
    }

    const enrollments =
      rateByClass.size === 0
        ? []
        : await this.prisma.enrollment.findMany({
            where: {
              classId: { in: [...rateByClass.keys()] },
              leftAt: null,
              enrolledAt: { lt: monthEnd },
              student: { deletedAt: null, status: 'ACTIVE' },
            },
            select: { studentId: true, classId: true, class: { select: { name: true } } },
          });
    // One TUITION invoice per STUDENT per period (plan 7.7 idempotency UQ), with
    // one line item per class — a student in two classes pays both rates in a
    // single invoice instead of losing the second to the unique constraint.
    const byStudent = new Map<string, Array<{ classId: string; className: string }>>();
    for (const enrollment of enrollments) {
      const list = byStudent.get(enrollment.studentId) ?? [];
      list.push({ classId: enrollment.classId, className: enrollment.class.name });
      byStudent.set(enrollment.studentId, list);
    }

    let created = 0;
    let skippedExisting = 0;
    for (const [studentId, classes] of byStudent) {
      const items = classes.map((entry) => {
        const rate = rateByClass.get(entry.classId) ?? 0;
        return {
          description: `Tuition ${dto.month}/${dto.year} — ${entry.className}`,
          quantity: 1,
          unitAmount: rate,
          amount: rate,
        };
      });
      const total = items.reduce((sum, item) => sum + item.amount, 0);
      try {
        await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.create({
            data: {
              invoiceNo: await this.nextInvoiceNo(tx, dto.year),
              studentId,
              type: 'TUITION',
              periodMonth: dto.month,
              periodYear: dto.year,
              subtotal: total,
              discount: 0,
              total,
              status: 'UNPAID',
              dueDate,
              note: `Tuition ${dto.month}/${dto.year}`,
              createdBy: caller.id,
            },
          });
          await tx.invoiceItem.createMany({
            data: items.map((item) => ({ invoiceId: invoice.id, ...item })),
          });
        });
        created += 1;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          skippedExisting += 1;
          continue;
        }
        throw error;
      }
    }
    this.audit.record({
      event: 'tuition_generated',
      success: true,
      detail: `period:${dto.month}/${dto.year} created:${created} skipped:${skippedExisting}`,
    });
    return {
      month: dto.month,
      year: dto.year,
      created,
      skippedExisting,
      classesSkipped,
      dueDate,
    };
  }

  /** Revenue by month and channel over SUCCESS payments (plan 8). */
  async revenue(caller: AuthenticatedUser, from: Date, to: Date): Promise<Record<string, unknown>> {
    const windowEnd = new Date(to);
    windowEnd.setUTCHours(23, 59, 59, 999);
    const payments = await this.prisma.paymentTransaction.findMany({
      where: { status: 'SUCCESS', paidAt: { gte: from, lte: windowEnd } },
      select: { amount: true, gateway: true, paidAt: true },
    });
    const byBucket = new Map<
      string,
      { month: string; gateway: string; total: number; count: number }
    >();
    let grandTotal = 0;
    for (const payment of payments) {
      const paidAt = payment.paidAt ?? new Date(0);
      const month = `${paidAt.getUTCFullYear()}-${String(paidAt.getUTCMonth() + 1).padStart(2, '0')}`;
      const key = `${month}:${payment.gateway}`;
      const bucket = byBucket.get(key) ?? { month, gateway: payment.gateway, total: 0, count: 0 };
      bucket.total += payment.amount;
      bucket.count += 1;
      byBucket.set(key, bucket);
      grandTotal += payment.amount;
    }
    return {
      from,
      to,
      rows: [...byBucket.values()].sort((a, b) =>
        a.month === b.month ? a.gateway.localeCompare(b.gateway) : a.month.localeCompare(b.month),
      ),
      grandTotal,
    };
  }

  private async assertInvoiceAccess(caller: AuthenticatedUser, studentId: string): Promise<void> {
    if (caller.role === 'ADMIN') {
      return;
    }
    if (caller.role === 'STUDENT') {
      const profile = await this.prisma.studentProfile.findFirst({
        where: { userId: caller.id, deletedAt: null, id: studentId },
        select: { id: true },
      });
      if (profile === null) {
        throw new NotFoundException('Not found');
      }
      return;
    }
    if (caller.role === 'PARENT') {
      const link = await this.prisma.parentStudentLink.findFirst({
        where: { parentUserId: caller.id, studentId, verified: true },
        select: { id: true },
      });
      if (link === null) {
        throw new NotFoundException('Not found');
      }
      return;
    }
    // INSTRUCTOR never sees invoices (plan 7.4).
    throw new NotFoundException('Not found');
  }

  private defaultDueDate(): Date {
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 14);
    return due;
  }

  private serializeInvoice(
    invoice: Invoice & { items?: InvoiceItem[] },
    withItems = false,
  ): Record<string, unknown> {
    const base = {
      id: invoice.id,
      invoiceNo: invoice.invoiceNo,
      studentId: invoice.studentId,
      type: invoice.type,
      periodMonth: invoice.periodMonth,
      periodYear: invoice.periodYear,
      subtotal: invoice.subtotal,
      discount: invoice.discount,
      total: invoice.total,
      status: invoice.status,
      dueDate: invoice.dueDate,
      issuedAt: invoice.issuedAt,
      note: invoice.note,
    };
    return withItems
      ? {
          ...base,
          items: (invoice.items ?? []).map((item) => ({
            id: item.id,
            description: item.description,
            quantity: item.quantity,
            unitAmount: item.unitAmount,
            amount: item.amount,
          })),
        }
      : base;
  }

  // ── Admin settings (matrix row 29): the two business keys the billing flows read ──

  async getSettings(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: ['tuition_rates', 'bank_account'] } },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      tuitionRates: byKey.get('tuition_rates') ?? {},
      bankAccount: byKey.get('bank_account') ?? null,
    };
  }

  /** Replaces the whole tuition_rates map; unknown class ids are rejected. */
  async updateTuitionRates(
    caller: AuthenticatedUser,
    rates: Array<{ classId: string; monthlyAmount: number }>,
  ): Promise<Record<string, unknown>> {
    const map: Record<string, number> = {};
    for (const rate of rates) {
      if (map[rate.classId] !== undefined) {
        throw new BadRequestException('Duplicate class id in rates');
      }
      map[rate.classId] = rate.monthlyAmount;
    }
    const classIds = Object.keys(map);
    if (classIds.length > 0) {
      const found = await this.prisma.class.count({ where: { id: { in: classIds } } });
      if (found !== classIds.length) {
        throw new BadRequestException('Unknown class id in rates');
      }
    }
    await this.prisma.appSetting.upsert({
      where: { key: 'tuition_rates' },
      update: { value: map, updatedBy: caller.id },
      create: { key: 'tuition_rates', value: map, updatedBy: caller.id },
    });
    this.audit.record({
      userId: caller.id,
      event: 'settings_updated',
      success: true,
      detail: `tuition_rates classes:${classIds.length}`,
    });
    return this.getSettings();
  }

  async updateBankAccount(
    caller: AuthenticatedUser,
    account: { bin: string; number: string; name: string; ownerType: 'BUSINESS' },
  ): Promise<Record<string, unknown>> {
    const value = {
      bin: account.bin,
      number: account.number,
      name: account.name,
      owner_type: account.ownerType,
    };
    await this.prisma.appSetting.upsert({
      where: { key: 'bank_account' },
      update: { value, updatedBy: caller.id },
      create: { key: 'bank_account', value, updatedBy: caller.id },
    });
    this.audit.record({
      userId: caller.id,
      event: 'settings_updated',
      success: true,
      detail: 'bank_account updated (owner_type BUSINESS)',
    });
    return this.getSettings();
  }

  /** Tuition close report for one period (matrix row 27): status totals + collected. */
  async tuitionReport(month: number, year: number): Promise<Record<string, unknown>> {
    const byStatus = await this.prisma.invoice.groupBy({
      by: ['status'],
      where: { type: 'TUITION', periodMonth: month, periodYear: year },
      _count: { _all: true },
      _sum: { total: true },
    });
    const collected = await this.prisma.paymentTransaction.aggregate({
      where: {
        status: 'SUCCESS',
        invoice: { type: 'TUITION', periodMonth: month, periodYear: year },
      },
      _sum: { amount: true },
    });
    return {
      month,
      year,
      byStatus: byStatus.map((row) => ({
        status: row.status,
        invoices: row._count._all,
        totalVnd: row._sum.total ?? 0,
      })),
      collectedVnd: collected._sum.amount ?? 0,
    };
  }

  // ── Discount codes ("khuyến mãi", matrix row 23) ─────────────────────────────

  async createDiscountCode(
    caller: AuthenticatedUser,
    dto: CreateDiscountCodeDto,
  ): Promise<Record<string, unknown>> {
    if ((dto.percentOff === undefined) === (dto.amountOff === undefined)) {
      throw new BadRequestException('Set exactly one of percentOff or amountOff');
    }
    if (dto.validUntil.getTime() <= dto.validFrom.getTime()) {
      throw new BadRequestException('validUntil must be after validFrom');
    }
    try {
      const row = await this.prisma.discountCode.create({
        data: {
          code: dto.code.toUpperCase(),
          description: dto.description,
          percentOff: dto.percentOff,
          amountOff: dto.amountOff,
          validFrom: dto.validFrom,
          validUntil: dto.validUntil,
        },
      });
      this.audit.record({
        userId: caller.id,
        event: 'discount_code_created',
        success: true,
        detail: `code:${row.code}`,
      });
      return this.serializeDiscountCode(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Discount code already exists');
      }
      throw error;
    }
  }

  async listDiscountCodes(page: number, limit: number): Promise<Record<string, unknown>> {
    const safeLimit = Math.min(limit, 100);
    const [total, items] = await this.prisma.$transaction([
      this.prisma.discountCode.count(),
      this.prisma.discountCode.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * safeLimit,
        take: safeLimit,
      }),
    ]);
    return {
      items: items.map((row) => this.serializeDiscountCode(row)),
      total,
      page,
      limit: safeLimit,
    };
  }

  async updateDiscountCode(
    caller: AuthenticatedUser,
    id: string,
    dto: UpdateDiscountCodeDto,
  ): Promise<Record<string, unknown>> {
    const existing = await this.prisma.discountCode.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    const row = await this.prisma.discountCode.update({
      where: { id },
      data: {
        ...(dto.description === undefined ? {} : { description: dto.description }),
        ...(dto.validUntil === undefined ? {} : { validUntil: dto.validUntil }),
        ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
      },
    });
    this.audit.record({
      userId: caller.id,
      event: 'discount_code_updated',
      success: true,
      detail: `code:${row.code} active:${row.isActive}`,
    });
    return this.serializeDiscountCode(row);
  }

  /** Codes are config, not financial records — the invoice keeps its discount amount. */
  async deleteDiscountCode(
    caller: AuthenticatedUser,
    id: string,
  ): Promise<Record<string, unknown>> {
    const existing = await this.prisma.discountCode.findUnique({ where: { id } });
    if (existing === null) {
      throw new NotFoundException('Not found');
    }
    await this.prisma.discountCode.delete({ where: { id } });
    this.audit.record({
      userId: caller.id,
      event: 'discount_code_deleted',
      success: true,
      detail: `code:${existing.code}`,
    });
    return { id, deleted: true };
  }

  /** Resolves a code to the extra discount it grants right now (400 when unusable). */
  private async resolveDiscountCode(code: string, subtotal: number): Promise<number> {
    const row = await this.prisma.discountCode.findUnique({ where: { code: code.toUpperCase() } });
    const now = new Date();
    if (
      row === null ||
      !row.isActive ||
      row.validFrom.getTime() > now.getTime() ||
      row.validUntil.getTime() < now.getTime()
    ) {
      throw new BadRequestException('Discount code is not valid');
    }
    return row.percentOff !== null && row.percentOff !== undefined
      ? Math.floor((subtotal * row.percentOff) / 100)
      : (row.amountOff ?? 0);
  }

  private serializeDiscountCode(row: {
    id: string;
    code: string;
    description: string | null;
    percentOff: number | null;
    amountOff: number | null;
    validFrom: Date;
    validUntil: Date;
    isActive: boolean;
  }): Record<string, unknown> {
    return {
      id: row.id,
      code: row.code,
      description: row.description,
      percentOff: row.percentOff,
      amountOff: row.amountOff,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      isActive: row.isActive,
    };
  }
}
