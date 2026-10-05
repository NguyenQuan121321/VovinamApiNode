import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { StudentOwnershipService } from '../students/student-ownership.service';
import type { PaymentGatewayPort } from './payment-gateway.port';
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

const invoice = {
  id: 'inv-1',
  invoiceNo: 'INV-2026-0001',
  studentId: 'sp-1',
  type: 'TUITION',
  periodMonth: 9,
  periodYear: 2026,
  subtotal: 100000,
  discount: 0,
  total: 100000,
  status: 'UNPAID',
  dueDate: new Date('2026-09-10'),
  issuedAt: new Date(),
  note: null,
  createdBy: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const pendingTxn = {
  id: 'pay-1',
  invoiceId: 'inv-1',
  orderRef: 'VVABCD2345',
  gateway: 'BANK_TRANSFER',
  gatewayTxnId: null,
  amount: 100000,
  status: 'PENDING',
  paidAt: null,
  expiresAt: new Date(Date.now() + 25 * 60_000),
  note: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makePrismaMock() {
  return {
    invoice: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    paymentTransaction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    appSetting: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock, provider: PaymentGatewayPort['provider'] = 'simulated') {
  prisma.$transaction.mockImplementation(async (arg: unknown) =>
    Array.isArray(arg)
      ? Promise.all(arg as Promise<unknown>[])
      : (arg as (tx: unknown) => unknown)(prisma),
  );
  const audit = { record: jest.fn() };
  const ownership = { assertCanAccess: jest.fn().mockResolvedValue(undefined) };
  const gateway: PaymentGatewayPort = {
    provider,
    createPayment: jest.fn().mockResolvedValue({ checkoutUrl: '/sim/VVABCD2345' }),
    verifySignature: jest.fn().mockReturnValue(true),
    parseEvent: jest.fn(),
  };
  const service = new PaymentsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    ownership as unknown as StudentOwnershipService,
    gateway,
  );
  return {
    service,
    auditRecord: audit.record as jest.Mock,
    ownership: ownership as { assertCanAccess: jest.Mock },
    gateway: gateway as {
      provider: 'simulated';
      createPayment: jest.Mock;
      verifySignature: jest.Mock;
      parseEvent: jest.Mock;
    },
  };
}

describe('PaymentsService (plan 7.5, S-03, S-11)', () => {
  let prisma: PrismaMock;
  let service: PaymentsService;
  let auditRecord: jest.Mock;
  let ownership: { assertCanAccess: jest.Mock };
  let gateway: { createPayment: jest.Mock; verifySignature: jest.Mock; parseEvent: jest.Mock };

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, auditRecord, ownership, gateway } = makeService(prisma));
    prisma.invoice.findUnique.mockResolvedValue(invoice);
    prisma.appSetting.findUnique.mockResolvedValue({
      key: 'bank_account',
      value: { owner_type: 'BUSINESS', bin: '9704', number: '0123456789', name: 'CLUB LLC' },
    });
    prisma.paymentTransaction.create.mockResolvedValue(pendingTxn);
    prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
  });

  describe('createQrPayment', () => {
    it('creates a PENDING transaction with a VV order ref and 30-minute expiry', async () => {
      const result = await service.createQrPayment(student, 'inv-1');
      expect(ownership.assertCanAccess).toHaveBeenCalledWith(student, 'sp-1');
      expect(result).toMatchObject({
        orderRef: expect.stringMatching(/^VV[A-HJ-NP-Z2-9]{8}$/),
        amount: 100000,
        checkoutUrl: '/sim/VVABCD2345',
      });
      const data = prisma.paymentTransaction.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING');
      expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_created', success: true }),
      );
    });

    it('refuses non-payable invoices, unconfigured bank accounts, and foreign invoices', async () => {
      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, status: 'PAID' });
      await expect(service.createQrPayment(student, 'inv-1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      prisma.invoice.findUnique.mockResolvedValue(invoice);
      prisma.appSetting.findUnique.mockResolvedValue({ key: 'bank_account', value: {} });
      await expect(service.createQrPayment(student, 'inv-1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      ownership.assertCanAccess.mockRejectedValue(new NotFoundException('Not found'));
      await expect(service.createQrPayment(student, 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('handleWebhook', () => {
    const headers = { 'x-signature': 'good' };
    const event = {
      orderRef: 'VVABCD2345',
      gatewayTxnId: 'GW-1',
      amount: 100000,
      success: true,
    };

    it('settles the invoice PAID when SUCCESS covers the total', async () => {
      gateway.parseEvent.mockReturnValue(event);
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100000 } });
      prisma.invoice.update.mockResolvedValue({ ...invoice, status: 'PAID' });

      const result = await service.handleWebhook('simulated', headers, '{}');
      expect(result).toEqual({ processed: true, outcome: 'SUCCESS' });
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PAID' } }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_succeeded', success: true }),
      );
    });

    it('answers 404 for an unknown provider and 401 for a bad signature (S-11)', async () => {
      await expect(service.handleWebhook('payos', headers, '{}')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      gateway.verifySignature.mockReturnValue(false);
      await expect(service.handleWebhook('simulated', headers, '{}')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.paymentTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('processes a duplicate delivery exactly once (S-03)', async () => {
      gateway.parseEvent.mockReturnValue(event);
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      // First delivery wins the claim; the duplicate sees count 0.
      prisma.paymentTransaction.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100000 } });

      const first = await service.handleWebhook('simulated', headers, '{}');
      expect(first).toEqual({ processed: true, outcome: 'SUCCESS' });
      const second = await service.handleWebhook('simulated', headers, '{}');
      expect(second).toEqual({ processed: false });
      expect(prisma.invoice.update).toHaveBeenCalledTimes(1);
    });

    it('flags an amount mismatch as DISPUTED and never marks paid (S-11)', async () => {
      gateway.parseEvent.mockReturnValue({ ...event, amount: 500 });
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.handleWebhook('simulated', headers, '{}');
      expect(result).toEqual({ processed: false, flagged: true });
      expect(prisma.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'DISPUTED' }) }),
      );
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_flagged', success: false }),
      );
    });

    it('ignores unknown order refs and failed transfers without touching the invoice', async () => {
      gateway.parseEvent.mockReturnValue(event);
      prisma.paymentTransaction.findUnique.mockResolvedValue(null);
      await expect(service.handleWebhook('simulated', headers, '{}')).resolves.toEqual({
        processed: false,
      });

      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
      gateway.parseEvent.mockReturnValue({ ...event, success: false });
      await expect(service.handleWebhook('simulated', headers, '{}')).resolves.toEqual({
        processed: true,
        outcome: 'FAILED',
      });
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it('answers 200 without side effects for a well-signed but malformed payload (DD-04)', async () => {
      gateway.parseEvent.mockReturnValue(null);
      await expect(service.handleWebhook('simulated', headers, 'not json')).resolves.toEqual({
        processed: false,
      });
      expect(prisma.paymentTransaction.updateMany).not.toHaveBeenCalled();
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it('answers 200 without side effects when a concurrent delivery wins the settle (S-03 race)', async () => {
      gateway.parseEvent.mockReturnValue(event);
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate gateway txn', {
          code: 'P2002',
          clientVersion: '6.12.0',
          meta: { target: ['gateway_txn_id'] },
        }),
      );
      await expect(service.handleWebhook('simulated', headers, '{}')).resolves.toEqual({
        processed: false,
      });
    });

    it('404s the payment history of unknown invoices', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(service.listForInvoice(student, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('records the gateway of the configured provider', async () => {
      const { service: payosService, prisma: payosPrisma } = (() => {
        const p = makePrismaMock();
        p.invoice.findUnique.mockResolvedValue(invoice);
        p.appSetting.findUnique.mockResolvedValue({
          key: 'bank_account',
          value: { owner_type: 'BUSINESS', bin: '9704', number: '0123456789', name: 'CLUB LLC' },
        });
        p.paymentTransaction.create.mockResolvedValue(pendingTxn);
        return { service: makeService(p, 'payos').service, prisma: p };
      })();
      await payosService.createQrPayment(student, 'inv-1');
      expect(payosPrisma.paymentTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gateway: 'PAYOS' }) }),
      );

      const { service: sepayService, prisma: sepayPrisma } = (() => {
        const p = makePrismaMock();
        p.invoice.findUnique.mockResolvedValue(invoice);
        p.appSetting.findUnique.mockResolvedValue({
          key: 'bank_account',
          value: { owner_type: 'BUSINESS', bin: '9704', number: '0123456789', name: 'CLUB LLC' },
        });
        p.paymentTransaction.create.mockResolvedValue(pendingTxn);
        return { service: makeService(p, 'sepay').service, prisma: p };
      })();
      await sepayService.createQrPayment(student, 'inv-1');
      expect(sepayPrisma.paymentTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gateway: 'SEPAY' }) }),
      );
    });
  });

  describe('confirmCash', () => {
    it('claims the invoice PAID and records a SUCCESS CASH transaction', async () => {
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentTransaction.create.mockResolvedValue({
        ...pendingTxn,
        gateway: 'CASH',
        status: 'SUCCESS',
        paidAt: new Date(),
      });
      const result = await service.confirmCash(admin, 'inv-1', 'Paid at the club');
      expect(result).toMatchObject({ gateway: 'CASH', status: 'SUCCESS' });
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_confirmed_cash', success: true }),
      );
    });

    it('404s unknown invoices and 409s already-paid ones', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(service.confirmCash(admin, 'missing', undefined)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, status: 'PAID' });
      prisma.invoice.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.confirmCash(admin, 'inv-1', undefined)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('setOutcome', () => {
    it('refunds a successful payment and re-derives the invoice to UNPAID', async () => {
      // First findUnique serves the payment lookup, the invoice lookup inside the
      // recompute must see a PAID invoice so the refund transitions it to UNPAID.
      prisma.paymentTransaction.findUnique.mockResolvedValueOnce({
        ...pendingTxn,
        status: 'SUCCESS',
        invoiceId: 'inv-1',
      });
      prisma.invoice.findUnique.mockResolvedValueOnce({ ...invoice, status: 'PAID' });
      prisma.paymentTransaction.update.mockResolvedValue({
        ...pendingTxn,
        status: 'REFUNDED',
      });
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      const result = await service.setOutcome(admin, 'pay-1', 'REFUNDED', 'Wrong transfer');
      expect(result).toMatchObject({ status: 'REFUNDED' });
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'UNPAID' } }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_refunded', success: true }),
      );
    });

    it('404s unknown payments and 409s non-successful ones', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValue(null);
      await expect(service.setOutcome(admin, 'missing', 'REFUNDED')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      prisma.paymentTransaction.findUnique.mockResolvedValue({ ...pendingTxn, status: 'PENDING' });
      await expect(service.setOutcome(admin, 'pay-1', 'REFUNDED')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('leaves invoices in non-payable states untouched by the recompute', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValueOnce({
        ...pendingTxn,
        status: 'SUCCESS',
      });
      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, status: 'CANCELLED' });
      prisma.paymentTransaction.update.mockResolvedValue({ ...pendingTxn, status: 'DISPUTED' });
      await service.setOutcome(admin, 'pay-1', 'DISPUTED', 'Under review');
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_flagged' }),
      );
    });

    it('flips an UNPAID invoice to PAID when the remaining SUCCESS payments still cover it', async () => {
      prisma.paymentTransaction.findUnique.mockResolvedValueOnce({
        ...pendingTxn,
        status: 'SUCCESS',
      });
      prisma.invoice.findUnique.mockResolvedValue({ ...invoice, status: 'UNPAID' });
      prisma.paymentTransaction.update.mockResolvedValue({ ...pendingTxn, status: 'REFUNDED' });
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amount: invoice.total } });
      await service.setOutcome(admin, 'pay-1', 'REFUNDED');
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'PAID' } }),
      );
    });
  });

  describe('listForInvoice', () => {
    it('scopes through the ownership guard and lists the history', async () => {
      prisma.paymentTransaction.findMany.mockResolvedValue([pendingTxn]);
      const result = await service.listForInvoice(student, 'inv-1');
      expect(result).toMatchObject({ total: 1 });
      expect(result.items[0]).toMatchObject({ orderRef: 'VVABCD2345' });

      ownership.assertCanAccess.mockRejectedValue(new NotFoundException('Not found'));
      await expect(service.listForInvoice(student, 'inv-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('R5: Payment Webhook Recovery & Transactional Integrity', () => {
    const headers = { 'x-signature': 'good' };
    const event = {
      orderRef: 'VVABCD2345',
      gatewayTxnId: 'GW-RECOVER-1',
      amount: 100000,
      success: true,
    };

    it('CASE 1: normal success settles payment and marks invoice PAID', async () => {
      gateway.parseEvent.mockReturnValue(event);
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100000 } });
      prisma.invoice.findUnique.mockResolvedValue(invoice);
      prisma.invoice.update.mockResolvedValue({ ...invoice, status: 'PAID' });

      const result = await service.handleWebhook('simulated', headers, '{}');
      expect(result).toEqual({ processed: true, outcome: 'SUCCESS' });
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1' }, data: { status: 'PAID' } }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_succeeded', success: true }),
      );
    });

    it('CASE 2: duplicate delivery after SUCCESS returns idempotent 200 no-op', async () => {
      gateway.parseEvent.mockReturnValue(event);
      prisma.paymentTransaction.findUnique.mockResolvedValue({
        ...pendingTxn,
        status: 'SUCCESS',
        gatewayTxnId: 'GW-RECOVER-1',
      });

      const result = await service.handleWebhook('simulated', headers, '{}');
      expect(result).toEqual({ processed: false });
      expect(prisma.paymentTransaction.updateMany).not.toHaveBeenCalled();
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it('CASE 3: parallel duplicate delivery is rejected cleanly without double settlement', async () => {
      gateway.parseEvent.mockReturnValue(event);
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.handleWebhook('simulated', headers, '{}');
      expect(result).toEqual({ processed: false });
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });

    it('CASE 4 & 5: settlement transaction failure rolls back claim; retry recovers and settles invoice', async () => {
      gateway.parseEvent.mockReturnValue(event);
      let paymentState: {
        id: string;
        invoiceId: string;
        orderRef: string;
        gateway: string;
        gatewayTxnId: string | null;
        amount: number;
        status: string;
        paidAt: Date | null;
        expiresAt: Date;
        note: string | null;
        createdAt: Date;
        updatedAt: Date;
      } = {
        ...pendingTxn,
        gatewayTxnId: null,
        status: 'PENDING',
      };
      let invoiceState = { ...invoice, status: 'UNPAID' };

      let simulateFailureOnFirstAttempt = true;

      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            $queryRaw: jest.fn().mockResolvedValue([]),
            paymentTransaction: {
              findFirst: jest.fn().mockResolvedValue(null),
              updateMany: jest
                .fn()
                .mockImplementation(async ({ data }: { data: { gatewayTxnId?: string } }) => {
                  if (paymentState.status !== 'PENDING' && paymentState.status !== 'FAILED') {
                    return { count: 0 };
                  }
                  if (
                    paymentState.gatewayTxnId !== null &&
                    paymentState.gatewayTxnId !== data.gatewayTxnId
                  ) {
                    return { count: 0 };
                  }
                  return { count: 1 };
                }),
              aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 100000 } }),
              update: jest.fn(),
            },
            invoice: {
              findUnique: jest.fn().mockImplementation(async () => invoiceState),
              update: jest
                .fn()
                .mockImplementation(async ({ data }: { data: { status: string } }) => {
                  if (simulateFailureOnFirstAttempt) {
                    throw new Error('Database serialization deadlock or connection timeout');
                  }
                  invoiceState = { ...invoiceState, status: data.status };
                  return invoiceState;
                }),
            },
          };

          const res = await callback(tx);
          paymentState = { ...paymentState, status: 'SUCCESS', gatewayTxnId: event.gatewayTxnId };
          return res;
        },
      );

      prisma.paymentTransaction.findUnique.mockImplementation(
        async () => paymentState as unknown as typeof pendingTxn,
      );

      // Attempt 1: Fails during settlement transaction
      await expect(service.handleWebhook('simulated', headers, '{}')).rejects.toThrow(
        'Database serialization deadlock or connection timeout',
      );

      // Assert rolled back: NOT permanently claimed
      expect(paymentState.status).toBe('PENDING');
      expect(paymentState.gatewayTxnId).toBeNull();
      expect(invoiceState.status).toBe('UNPAID');

      // Attempt 2: Gateway retries the exact same webhook
      simulateFailureOnFirstAttempt = false;
      const retryResult = await service.handleWebhook('simulated', headers, '{}');

      // Assert recovered
      expect(retryResult).toEqual({ processed: true, outcome: 'SUCCESS' });
      expect(paymentState.status).toBe('SUCCESS');
      expect(paymentState.gatewayTxnId).toBe(event.gatewayTxnId);
      expect(invoiceState.status).toBe('PAID');
    });

    it('CASE 6: amount mismatch marks payment DISPUTED and never settles invoice', async () => {
      gateway.parseEvent.mockReturnValue({ ...event, amount: 50000 });
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.update.mockResolvedValue({
        ...pendingTxn,
        status: 'DISPUTED',
      });

      const result = await service.handleWebhook('simulated', headers, '{}');
      expect(result).toEqual({ processed: false, flagged: true });
      expect(prisma.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DISPUTED',
            note: expect.stringContaining('Amount mismatch'),
          }),
        }),
      );
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_flagged', success: false }),
      );
    });

    it('CASE 7: gateway reports FAILED transfer marks payment FAILED without settling invoice', async () => {
      gateway.parseEvent.mockReturnValue({ ...event, success: false });
      prisma.paymentTransaction.findUnique.mockResolvedValue(pendingTxn);
      prisma.paymentTransaction.update.mockResolvedValue({
        ...pendingTxn,
        status: 'FAILED',
      });

      const result = await service.handleWebhook('simulated', headers, '{}');
      expect(result).toEqual({ processed: true, outcome: 'FAILED' });
      expect(prisma.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'FAILED',
            note: 'Gateway reported a failed transfer',
          }),
        }),
      );
      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_failed', success: true }),
      );
    });
  });

  describe('R6: QR Expiration, Concurrency, and Overpayment Handling', () => {
    const headers = { 'x-signature': 'good' };

    it('one QR creates a single pending transaction', async () => {
      const result = await service.createQrPayment(student, 'inv-1');
      expect(result.status).toBe('PENDING');
      expect(prisma.paymentTransaction.create).toHaveBeenCalledTimes(1);
    });

    it('duplicate QR creation invalidates/expires the previous pending payment', async () => {
      await service.createQrPayment(student, 'inv-1');
      await service.createQrPayment(student, 'inv-1');

      expect(prisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invoiceId: 'inv-1', status: 'PENDING' },
          data: expect.objectContaining({
            status: 'FAILED',
            note: 'Superseded by newer payment request',
          }),
        }),
      );
    });

    it('concurrent QR creation serializes and invalidates previous PENDING', async () => {
      const p1 = service.createQrPayment(student, 'inv-1');
      const p2 = service.createQrPayment(student, 'inv-1');
      await Promise.all([p1, p2]);

      expect(prisma.paymentTransaction.updateMany).toHaveBeenCalled();
      expect(prisma.paymentTransaction.create).toHaveBeenCalledTimes(2);
    });

    it('two successful callbacks exceeding invoice total trigger overpayment detection', async () => {
      const event1 = {
        orderRef: 'VVABCD2345',
        gatewayTxnId: 'GW-1',
        amount: 100000,
        success: true,
      };
      const event2 = {
        orderRef: 'VVWXYZ6789',
        gatewayTxnId: 'GW-2',
        amount: 100000,
        success: true,
      };

      gateway.parseEvent.mockReturnValueOnce(event1).mockReturnValueOnce(event2);
      prisma.paymentTransaction.findUnique
        .mockResolvedValueOnce({ ...pendingTxn, orderRef: 'VVABCD2345' })
        .mockResolvedValueOnce({ ...pendingTxn, id: 'pay-2', orderRef: 'VVWXYZ6789' });

      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentTransaction.aggregate
        .mockResolvedValueOnce({ _sum: { amount: 100000 } })
        .mockResolvedValueOnce({ _sum: { amount: 200000 } });

      prisma.invoice.findUnique.mockResolvedValue(invoice);
      prisma.invoice.update.mockResolvedValue({ ...invoice, status: 'PAID' });
      prisma.paymentTransaction.update.mockResolvedValue({ id: 'pay-2', status: 'DISPUTED' });

      const res1 = await service.handleWebhook('simulated', headers, '{}');
      expect(res1).toEqual({ processed: true, outcome: 'SUCCESS' });
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1' }, data: { status: 'PAID' } }),
      );

      const res2 = await service.handleWebhook('simulated', headers, '{}');
      expect(res2).toEqual(
        expect.objectContaining({
          processed: false,
          flagged: true,
          overpaid: true,
          totalSettled: 200000,
        }),
      );
      expect(prisma.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-2' },
          data: expect.objectContaining({
            status: 'DISPUTED',
            note: expect.stringContaining('Overpayment detected'),
          }),
        }),
      );
      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({
            note: expect.stringContaining('Overpayment detected'),
          }),
        }),
      );
      expect(auditRecord).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'payment_flagged', success: false }),
      );
    });

    it('one success + one failed transaction settles invoice without overpayment', async () => {
      const eventSuccess = {
        orderRef: 'VVABCD2345',
        gatewayTxnId: 'GW-OK',
        amount: 100000,
        success: true,
      };
      const eventFail = {
        orderRef: 'VVFAIL1234',
        gatewayTxnId: 'GW-FAIL',
        amount: 100000,
        success: false,
      };

      gateway.parseEvent.mockReturnValueOnce(eventSuccess).mockReturnValueOnce(eventFail);
      prisma.paymentTransaction.findUnique
        .mockResolvedValueOnce({ ...pendingTxn, orderRef: 'VVABCD2345' })
        .mockResolvedValueOnce({ ...pendingTxn, id: 'pay-fail', orderRef: 'VVFAIL1234' });

      prisma.paymentTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.paymentTransaction.aggregate.mockResolvedValue({ _sum: { amount: 100000 } });
      prisma.invoice.findUnique.mockResolvedValue(invoice);
      prisma.invoice.update.mockResolvedValue({ ...invoice, status: 'PAID' });
      prisma.paymentTransaction.update.mockResolvedValue({ id: 'pay-fail', status: 'FAILED' });

      const resSuccess = await service.handleWebhook('simulated', headers, '{}');
      expect(resSuccess).toEqual({ processed: true, outcome: 'SUCCESS' });

      const resFail = await service.handleWebhook('simulated', headers, '{}');
      expect(resFail).toEqual({ processed: true, outcome: 'FAILED' });
      expect(prisma.paymentTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-fail' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('expired payment then new QR creates fresh pending payment and preserves expired', async () => {
      const expiredTxn = {
        ...pendingTxn,
        id: 'pay-expired',
        expiresAt: new Date(Date.now() - 10 * 60_000),
      };
      prisma.paymentTransaction.findMany.mockResolvedValue([expiredTxn]);

      const result = await service.createQrPayment(student, 'inv-1');
      expect(result.status).toBe('PENDING');
      expect(prisma.paymentTransaction.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { invoiceId: 'inv-1', status: 'PENDING' },
          data: expect.objectContaining({
            status: 'FAILED',
            note: 'Superseded by newer payment request',
          }),
        }),
      );
      expect(prisma.paymentTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            invoiceId: 'inv-1',
            status: 'PENDING',
          }),
        }),
      );
    });
  });
});
