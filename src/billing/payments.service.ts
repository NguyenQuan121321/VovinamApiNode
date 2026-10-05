import { randomBytes } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import { PaymentGateway, PaymentTxnStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../auth/audit/audit.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { PAYMENT_GATEWAY_PORT, type PaymentGatewayPort } from './payment-gateway.port';

const QR_TTL_MINUTES = 30;
const ORDER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** "VV" + 8 unambiguous characters, embedded in the transfer content (plan 6). */
function generateOrderRef(): string {
  const bytes = randomBytes(8);
  let ref = 'VV';
  for (const byte of bytes) {
    ref += ORDER_ALPHABET[byte % ORDER_ALPHABET.length];
  }
  return ref;
}

/**
 * Payments (plan sections 6, 7.5, 8): QR initiation behind the PaymentGateway
 * port, an idempotent HMAC-verified webhook (S-03: gateway_txn_id claimed
 * exactly once; duplicate/parallel deliveries answer 200 without side effects),
 * and the exact-amount rule (S-11: a mismatch is flagged for review and never
 * marks the invoice paid). CASH confirmation and refunds/disputes are admin
 * operations. Invoices become PAID when SUCCESS transactions cover the total.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ownership: StudentOwnershipService,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
  ) {}

  async createQrPayment(
    caller: AuthenticatedUser,
    invoiceId: string,
  ): Promise<Record<string, unknown>> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (invoice === null) {
      throw new NotFoundException('Not found');
    }
    await this.ownership.assertCanAccess(caller, invoice.studentId);
    if (invoice.status !== 'UNPAID' && invoice.status !== 'OVERDUE') {
      throw new ConflictException('Invoice is not payable');
    }
    // Plan 10: the fee-collecting account must be the legal entity's.
    await this.assertBankAccountConfigured();

    const orderRef = generateOrderRef();
    const expiresAt = new Date(Date.now() + QR_TTL_MINUTES * 60_000);
    const checkout = await this.gateway.createPayment({
      orderRef,
      amount: invoice.total,
      description: `Vovinam fee ${orderRef}`,
      expiresAt,
    });

    const txn = await this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, invoiceId);
      const current = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (current === null) throw new NotFoundException('Not found');
      if (current.status !== 'UNPAID' && current.status !== 'OVERDUE') {
        throw new ConflictException('Invoice is not payable');
      }
      // Invalidate/expire any existing PENDING payment for this invoice before creating a new one (R6)
      await tx.paymentTransaction.updateMany({
        where: {
          invoiceId,
          status: 'PENDING',
        },
        data: {
          status: 'FAILED',
          note: 'Superseded by newer payment request',
          expiresAt: new Date(),
        },
      });

      return tx.paymentTransaction.create({
        data: {
          invoiceId,
          orderRef,
          gateway: this.gatewayForProvider(),
          amount: invoice.total,
          status: 'PENDING',
          expiresAt,
        },
      });
    });

    this.audit.record({
      userId: caller.id,
      event: 'payment_created',
      success: true,
      detail: `payment:${txn.id} invoice:${invoiceId} order_ref:${orderRef}`,
    });
    return {
      paymentId: txn.id,
      orderRef,
      amount: txn.amount,
      status: txn.status,
      expiresAt: txn.expiresAt,
      checkoutUrl: checkout.checkoutUrl,
      ...(checkout.qrCodeDataUrl === undefined ? {} : { qrCodeDataUrl: checkout.qrCodeDataUrl }),
    };
  }

  /**
   * Public gateway webhook. Invalid signatures receive 401. Processed,
   * duplicate and unrecognized signed events receive 200; storage failures
   * remain retryable server errors.
   * Atomically claims and settles inside one transaction so failures can be
   * retried safely without stranding payments (R5, R6).
   */
  async handleWebhook(
    provider: string,
    headers: IncomingHttpHeaders,
    rawBody: string,
  ): Promise<Record<string, unknown>> {
    if (provider !== this.gateway.provider) {
      throw new NotFoundException('Not found');
    }
    if (!this.gateway.verifySignature(headers, rawBody)) {
      throw new UnauthorizedException('Invalid signature');
    }
    const event = this.gateway.parseEvent(rawBody);
    if (event === null) {
      // Signed but unreadable: nothing to process. Still 200 so the gateway
      // stops retrying garbage events; only a bad signature answers 401 (DD-04).
      return { processed: false };
    }
    const txn = await this.prisma.paymentTransaction.findUnique({
      where: { orderRef: event.orderRef },
    });
    if (txn === null) {
      // Unknown order reference: nothing to process, still 200.
      return { processed: false };
    }

    // Idempotency: duplicate delivery of an already succeeded payment returns 200 no-op
    if (txn.status === 'SUCCESS' || txn.status === 'DISPUTED' || txn.status === 'REFUNDED') {
      return { processed: false };
    }
    if (txn.status === 'FAILED' && txn.gatewayTxnId === event.gatewayTxnId) {
      return { processed: false };
    }

    // Gateway reported failure: atomically transition to FAILED
    if (!event.success) {
      const changed = await this.transitionReceipt(
        txn,
        event.gatewayTxnId,
        'FAILED',
        'Gateway reported a failed transfer',
      );
      if (!changed) return { processed: false };
      this.audit.record({
        event: 'payment_failed',
        success: true,
        detail: `payment:${txn.id} order_ref:${txn.orderRef}`,
      });
      return { processed: true, outcome: 'FAILED' };
    }

    // Amount mismatch: S-11 exact amount rule -> mark DISPUTED
    if (event.amount !== txn.amount) {
      const changed = await this.transitionReceipt(
        txn,
        event.gatewayTxnId,
        'DISPUTED',
        `Amount mismatch: expected ${txn.amount}, received ${event.amount}`,
      );
      if (!changed) return { processed: false };
      this.audit.record({
        event: 'payment_flagged',
        success: false,
        detail: `payment:${txn.id} order_ref:${txn.orderRef} expected:${txn.amount} received:${event.amount}`,
      });
      return { processed: false, flagged: true };
    }

    // Atomic claim + settlement inside ONE transaction (R5 + R6)
    try {
      type SettlementResult =
        | { processed: false; flagged?: boolean; overpaid?: boolean; totalSettled?: number }
        | { processed: true; outcome: 'SUCCESS' };

      const result = await this.prisma.$transaction(async (tx): Promise<SettlementResult> => {
        await this.lockInvoice(tx, txn.invoiceId);
        const expired = await tx.paymentTransaction.findFirst({
          where: {
            id: txn.id,
            status: { in: ['PENDING', 'FAILED'] },
            expiresAt: { lte: new Date() },
          },
        });
        if (expired !== null) {
          const flagged = await tx.paymentTransaction.updateMany({
            where: {
              id: txn.id,
              status: { in: ['PENDING', 'FAILED'] },
              OR: [{ gatewayTxnId: null }, { gatewayTxnId: event.gatewayTxnId }],
            },
            data: {
              status: 'DISPUTED',
              gatewayTxnId: event.gatewayTxnId,
              paidAt: new Date(),
              note: 'Transfer received after QR expiration; requires manual reconciliation',
            },
          });
          return flagged.count > 0 ? { processed: false, flagged: true } : { processed: false };
        }
        // Atomic claim: only claim if status is PENDING (or superseded) and gatewayTxnId is either null or this retry's gatewayTxnId
        const claimed = await tx.paymentTransaction.updateMany({
          where: {
            id: txn.id,
            status: { in: ['PENDING', 'FAILED'] },
            OR: [{ gatewayTxnId: null }, { gatewayTxnId: event.gatewayTxnId }],
          },
          data: {
            gatewayTxnId: event.gatewayTxnId,
            status: 'SUCCESS',
            paidAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          // Already claimed/settled by concurrent delivery
          return { processed: false };
        }

        const invoice = await tx.invoice.findUnique({ where: { id: txn.invoiceId } });
        if (invoice === null) {
          throw new NotFoundException('Not found');
        }

        if (invoice.status === 'CANCELLED' || invoice.status === 'REFUNDED') {
          await tx.paymentTransaction.update({
            where: { id: txn.id },
            data: {
              status: 'DISPUTED',
              note: 'Transfer received for a non-payable invoice; requires manual reconciliation',
            },
          });
          return { processed: false, flagged: true };
        }

        // Sum all SUCCESS payments for this invoice
        const settled = await tx.paymentTransaction.aggregate({
          where: { invoiceId: txn.invoiceId, status: 'SUCCESS' },
          _sum: { amount: true },
        });
        const totalSettled = settled._sum.amount ?? 0;

        // R6: Overpayment policy
        if (totalSettled > invoice.total) {
          // Mark excess payment transaction as DISPUTED
          await tx.paymentTransaction.update({
            where: { id: txn.id },
            data: {
              status: 'DISPUTED',
              note: `Overpayment detected: total settled ${totalSettled} exceeds invoice total ${invoice.total}; requires manual resolution`,
            },
          });
          const noteText = invoice.note
            ? `${invoice.note}; Overpayment detected: total received ${totalSettled} exceeds invoice total ${invoice.total}`
            : `Overpayment detected: total received ${totalSettled} exceeds invoice total ${invoice.total}`;
          await tx.invoice.update({
            where: { id: txn.invoiceId },
            data: { note: noteText.slice(0, 500) },
          });
          return { processed: false, flagged: true, overpaid: true, totalSettled };
        }

        // Normal settlement: mark invoice PAID if total is reached
        const paid = totalSettled >= invoice.total;
        if (paid && (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE')) {
          await tx.invoice.update({ where: { id: txn.invoiceId }, data: { status: 'PAID' } });
        }

        return { processed: true, outcome: 'SUCCESS' };
      });

      if (result.processed && result.outcome === 'SUCCESS') {
        this.audit.record({
          event: 'payment_succeeded',
          success: true,
          detail: `payment:${txn.id} invoice:${txn.invoiceId} amount:${txn.amount}`,
        });
      } else if (!result.processed && result.flagged) {
        this.audit.record({
          event: 'payment_flagged',
          success: false,
          detail: `payment:${txn.id} invoice:${txn.invoiceId} reconciliation_required total_settled:${result.totalSettled ?? 0}`,
        });
      }

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent delivery stored this gateway_txn_id first: no-op, 200.
        return { processed: false };
      }
      throw error;
    }
  }

  /** ADMIN cash confirmation (plan 7.5) — claim-first so it is idempotent. */
  async confirmCash(
    caller: AuthenticatedUser,
    invoiceId: string,
    note?: string,
  ): Promise<Record<string, unknown>> {
    const invoice = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (invoice === null) {
      throw new NotFoundException('Not found');
    }
    const txn = await this.prisma.$transaction(async (tx) => {
      await this.lockInvoice(tx, invoiceId);
      const current = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (current === null) throw new NotFoundException('Not found');
      const claimed = await tx.invoice.updateMany({
        where: { id: invoiceId, status: { in: ['UNPAID', 'OVERDUE'] } },
        data: { status: 'PAID' },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Invoice is already paid or not payable');
      }
      return tx.paymentTransaction.create({
        data: {
          invoiceId,
          orderRef: generateOrderRef(),
          gateway: 'CASH',
          amount: invoice.total,
          status: 'SUCCESS',
          paidAt: new Date(),
          recordedBy: caller.id,
          note,
        },
      });
    });
    this.audit.record({
      userId: caller.id,
      event: 'payment_confirmed_cash',
      success: true,
      detail: `payment:${txn.id} invoice:${invoiceId} amount:${txn.amount} admin:${caller.id}`,
    });
    return this.serializePayment(txn);
  }

  /** ADMIN marks a wrong transfer refunded or disputed (plan 7.5). */
  async setOutcome(
    caller: AuthenticatedUser,
    paymentId: string,
    status: 'REFUNDED' | 'DISPUTED',
    note?: string,
  ): Promise<Record<string, unknown>> {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT i.id FROM "invoices" i JOIN "payment_transactions" p
        ON p.invoice_id = i.id WHERE p.id = ${paymentId}::uuid FOR UPDATE OF i`;
      const txn = await tx.paymentTransaction.findUnique({
        where: { id: paymentId },
        select: { id: true, invoiceId: true, status: true, note: true },
      });
      if (txn === null) {
        throw new NotFoundException('Not found');
      }
      if (txn.status !== 'SUCCESS' && !(txn.status === 'DISPUTED' && status === 'REFUNDED')) {
        throw new ConflictException(
          'Only successful payments can be disputed; successful or disputed receipts can be refunded',
        );
      }
      const result = await tx.paymentTransaction.update({
        where: { id: paymentId },
        data: { status, note: note ?? txn.note },
      });
      await this.recomputeInvoiceStatus(tx, txn.invoiceId);
      return result;
    });
    this.audit.record({
      userId: caller.id,
      event: status === 'REFUNDED' ? 'payment_refunded' : 'payment_flagged',
      success: true,
      detail: `payment:${paymentId} admin:${caller.id} note:${note ?? ''}`.slice(0, 500),
    });
    return this.serializePayment(updated);
  }

  /** Payment history of one invoice, guarded by plan 7.3 for every role. */
  async listForInvoice(
    caller: AuthenticatedUser,
    invoiceId: string,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, studentId: true },
    });
    if (invoice === null) {
      throw new NotFoundException('Not found');
    }
    await this.ownership.assertCanAccess(caller, invoice.studentId);
    const payments = await this.prisma.paymentTransaction.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: payments.map((payment) => this.serializePayment(payment)),
      total: payments.length,
    };
  }

  /** Serializes all money transitions for one invoice. */
  private async lockInvoice(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "invoices" WHERE id = ${invoiceId}::uuid FOR UPDATE`;
  }

  private async transitionReceipt(
    payment: { id: string; invoiceId: string },
    gatewayTxnId: string,
    status: 'FAILED' | 'DISPUTED',
    note: string,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockInvoice(tx, payment.invoiceId);
        const claimed = await tx.paymentTransaction.updateMany({
          where: {
            id: payment.id,
            status: { in: ['PENDING', 'FAILED'] },
            OR: [{ gatewayTxnId: null }, { gatewayTxnId }],
          },
          data: { gatewayTxnId },
        });
        if (claimed.count === 0) return false;
        await tx.paymentTransaction.update({
          where: { id: payment.id },
          data: { status, gatewayTxnId, note },
        });
        return true;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return false;
      throw error;
    }
  }

  /** Re-derives UNPAID/PAID after a refund or dispute; OVERDUE only flips to PAID. */
  private async recomputeInvoiceStatus(
    tx: Prisma.TransactionClient,
    invoiceId: string,
  ): Promise<void> {
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (invoice === null) {
      return;
    }
    if (invoice.status !== 'UNPAID' && invoice.status !== 'PAID' && invoice.status !== 'OVERDUE') {
      return;
    }
    const settled = await tx.paymentTransaction.aggregate({
      where: { invoiceId, status: 'SUCCESS' },
      _sum: { amount: true },
    });
    const paid = (settled._sum.amount ?? 0) >= invoice.total;
    if (paid && invoice.status !== 'PAID') {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } });
    } else if (!paid && invoice.status === 'PAID') {
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'UNPAID' } });
    }
  }

  private async assertBankAccountConfigured(): Promise<void> {
    const setting = await this.prisma.appSetting.findUnique({ where: { key: 'bank_account' } });
    const account = setting?.value as
      { owner_type?: string; bin?: string; number?: string; name?: string } | undefined;
    if (account?.owner_type !== 'BUSINESS' || !account.bin || !account.number || !account.name) {
      throw new ConflictException('Receiving bank account is not configured');
    }
  }

  /** The simulated adapter records as BANK_TRANSFER (a simulated local transfer). */
  private gatewayForProvider(): PaymentGateway {
    switch (this.gateway.provider) {
      case 'payos':
        return 'PAYOS';
      case 'sepay':
        return 'SEPAY';
      default:
        return 'BANK_TRANSFER';
    }
  }

  private serializePayment(payment: {
    id: string;
    invoiceId: string;
    orderRef: string;
    gateway: PaymentGateway;
    gatewayTxnId: string | null;
    amount: number;
    status: PaymentTxnStatus;
    paidAt: Date | null;
    expiresAt: Date | null;
    note: string | null;
  }): Record<string, unknown> {
    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      orderRef: payment.orderRef,
      gateway: payment.gateway,
      amount: payment.amount,
      status: payment.status,
      paidAt: payment.paidAt,
      expiresAt: payment.expiresAt,
      note: payment.note,
    };
  }
}
