import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../auth/audit/audit.service';

/** Minimal transaction handle the invoice methods need (works with PrismaService or a tx client). */
export type Tx = Pick<Prisma.TransactionClient, 'invoice' | 'invoiceItem'>;

interface ExamFeeInvoiceArgs {
  studentId: string;
  exam: { code: string; title: string; feeAmount: number; examDate: Date };
  examRegistrationId: string;
  createdBy: string;
}

/**
 * Invoice issuance (plan sections 6, 7.5). P3 only issues EXAM_FEE invoices for
 * exam registrations — payments, QR and generate-monthly arrive in P4. Invoices
 * are never hard-deleted and payment_transactions will reference them with
 * ON DELETE RESTRICT, so the chain stays intact (plan 7.2, 10).
 */
@Injectable()
export class BillingService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Issues the single-line EXAM_FEE invoice for one exam registration inside the
   * caller's transaction, so registration + invoice commit atomically. invoice_no
   * is sequential per year (INV-2026-0001) guarded by the unique constraint with
   * a bounded retry on conflicts (plan 9).
   */
  async createExamFeeInvoice(
    tx: Tx,
    args: ExamFeeInvoiceArgs,
  ): Promise<{ id: string; invoiceNo: string; total: number; status: string }> {
    const year = new Date().getUTCFullYear();
    const prefix = `INV-${year}-`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const last = await tx.invoice.findFirst({
        where: { invoiceNo: { startsWith: prefix } },
        orderBy: { invoiceNo: 'desc' },
        select: { invoiceNo: true },
      });
      const seq = last === null ? 1 : Number.parseInt(last.invoiceNo.slice(prefix.length), 10) + 1;
      const invoiceNo = `${prefix}${String(seq).padStart(4, '0')}`;
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
}
