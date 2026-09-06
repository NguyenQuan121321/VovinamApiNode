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
    const txn = await this.prisma.paymentTransaction.create({
      data: {
        invoiceId,
        orderRef,
        gateway: this.gatewayForProvider(),
        amount: invoice.total,
        status: 'PENDING',
        expiresAt,
      },
    });
    this.audit.record({
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
   * Public gateway webhook. Signature first (401 stops the provider), then
   * everything else answers 200 so the gateway never retries a processed event.
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
      throw new UnauthorizedException('Malformed webhook payload');
    }
    const txn = await this.prisma.paymentTransaction.findUnique({
      where: { orderRef: event.orderRef },
    });
    if (txn === null) {
      // Unknown order reference: nothing to process, still 200.
      return { processed: false };
    }
    // Idempotency claim: exactly one delivery may transition PENDING -> terminal
    // (S-03). A losing concurrent delivery (or a replay) sees count 0.
    const claimed = await this.prisma.paymentTransaction.updateMany({
      where: { id: txn.id, gatewayTxnId: null, status: 'PENDING' },
      data: { gatewayTxnId: event.gatewayTxnId },
    });
    if (claimed.count === 0) {
      return { processed: false };
    }
    try {
      if (!event.success) {
        await this.prisma.paymentTransaction.update({
          where: { id: txn.id },
          data: { status: 'FAILED', note: 'Gateway reported a failed transfer' },
        });
        this.audit.record({
          event: 'payment_failed',
          success: true,
          detail: `payment:${txn.id} order_ref:${txn.orderRef}`,
        });
        return { processed: true, outcome: 'FAILED' };
      }
      if (event.amount !== txn.amount) {
        // S-11: never mark paid on an amount mismatch — flag for manual review.
        await this.prisma.paymentTransaction.update({
          where: { id: txn.id },
          data: {
            status: 'DISPUTED',
            note: `Amount mismatch: expected ${txn.amount}, received ${event.amount}`,
          },
        });
        this.audit.record({
          event: 'payment_flagged',
          success: false,
          detail: `payment:${txn.id} order_ref:${txn.orderRef} expected:${txn.amount} received:${event.amount}`,
        });
        return { processed: false, flagged: true };
      }
      await this.settleInvoice(txn.invoiceId, txn.id);
      this.audit.record({
        event: 'payment_succeeded',
        success: true,
        detail: `payment:${txn.id} invoice:${txn.invoiceId} amount:${txn.amount}`,
      });
      return { processed: true, outcome: 'SUCCESS' };
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
      const txn = await tx.paymentTransaction.findUnique({
        where: { id: paymentId },
        select: { id: true, invoiceId: true, status: true, note: true },
      });
      if (txn === null) {
        throw new NotFoundException('Not found');
      }
      if (txn.status !== 'SUCCESS') {
        throw new ConflictException('Only successful payments can be refunded or disputed');
      }
      const result = await tx.paymentTransaction.update({
        where: { id: paymentId },
        data: { status, note: note ?? txn.note },
      });
      await this.recomputeInvoiceStatus(tx, txn.invoiceId);
      return result;
    });
    this.audit.record({
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

  /**
   * Marks the payment SUCCESS and the invoice PAID once SUCCESS transactions
   * cover the total (plan 7.5).
   */
  private async settleInvoice(invoiceId: string, paymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: paymentId },
        data: { status: 'SUCCESS', paidAt: new Date() },
      });
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (invoice === null) {
        throw new NotFoundException('Not found');
      }
      const settled = await tx.paymentTransaction.aggregate({
        where: { invoiceId, status: 'SUCCESS' },
        _sum: { amount: true },
      });
      const paid = (settled._sum.amount ?? 0) >= invoice.total;
      if (paid && (invoice.status === 'UNPAID' || invoice.status === 'OVERDUE')) {
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: 'PAID' } });
      }
    });
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
