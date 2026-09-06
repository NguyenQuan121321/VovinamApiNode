import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Invoice, InvoiceItem, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import type { CreateInvoiceDto, GenerateMonthlyDto, ListInvoicesQueryDto } from './dto/billing.dto';

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
    const last = await tx.invoice.findFirst({
      where: { invoiceNo: { startsWith: prefix } },
      orderBy: { invoiceNo: 'desc' },
      select: { invoiceNo: true },
    });
    const seq = last === null ? 1 : Number.parseInt(last.invoiceNo.slice(prefix.length), 10) + 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
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
      select: { id: true, status: true },
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
    const discount = dto.discount ?? 0;
    if (discount > subtotal) {
      throw new BadRequestException('Discount cannot exceed the subtotal');
    }
    const dueDate = dto.dueDate === undefined ? this.defaultDueDate() : new Date(dto.dueDate);
    const created = await this.prisma.$transaction(async (tx) => {
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
      return invoice;
    });
    this.audit.record({
      event: 'invoice_created',
      success: true,
      detail: `invoice:${created.id} student:${dto.studentId}`,
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
            select: { studentId: true, classId: true },
          });
    // A student may have left and rejoined within the period — one invoice per pair.
    const pairs = new Map<string, string>();
    for (const enrollment of enrollments) {
      pairs.set(`${enrollment.studentId}:${enrollment.classId}`, enrollment.studentId);
    }

    let created = 0;
    let skippedExisting = 0;
    for (const [pair, studentId] of pairs) {
      const classId = pair.split(':')[1] ?? '';
      const rate = rateByClass.get(classId) ?? 0;
      try {
        await this.prisma.$transaction(async (tx) => {
          const invoice = await tx.invoice.create({
            data: {
              invoiceNo: await this.nextInvoiceNo(tx, dto.year),
              studentId,
              type: 'TUITION',
              periodMonth: dto.month,
              periodYear: dto.year,
              subtotal: rate,
              discount: 0,
              total: rate,
              status: 'UNPAID',
              dueDate,
              note: `Tuition ${dto.month}/${dto.year}`,
              createdBy: caller.id,
            },
          });
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              description: `Tuition ${dto.month}/${dto.year}`,
              quantity: 1,
              unitAmount: rate,
              amount: rate,
            },
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
}
