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
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      aggregate: jest.fn(),
    },
    appSetting: { findUnique: jest.fn() },
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

    it('answers 401 for a well-signed but malformed payload', async () => {
      gateway.parseEvent.mockReturnValue(null);
      await expect(service.handleWebhook('simulated', headers, 'not json')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
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
});
