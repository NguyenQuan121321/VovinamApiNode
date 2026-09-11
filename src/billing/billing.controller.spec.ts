import type { Request } from 'express';
import { BillingController, PaymentsController } from './billing.controller';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';

describe('Billing and payments controllers', () => {
  const billing = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getById: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    create: jest.fn().mockResolvedValue({ id: 'inv-1' }),
    generateMonthly: jest.fn().mockResolvedValue({ created: 1 }),
    revenue: jest.fn().mockResolvedValue({ rows: [] }),
  };
  const payments = {
    createQrPayment: jest.fn().mockResolvedValue({ orderRef: 'VVABCD2345' }),
    handleWebhook: jest.fn().mockResolvedValue({ processed: true }),
    confirmCash: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    setOutcome: jest.fn().mockResolvedValue({ status: 'REFUNDED' }),
    listForInvoice: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  };
  const billingController = new BillingController(billing as never);
  const paymentsController = new PaymentsController(payments as never);
  const user = { id: 'u-1', role: 'ADMIN', sessionId: 's', jti: 'j' } as AuthenticatedUser;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates invoice operations to the billing service', async () => {
    await billingController.list(user, { page: 1, limit: 20 });
    expect(billing.list).toHaveBeenCalledWith(user, { page: 1, limit: 20 });

    await billingController.getById(user, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(billing.getById).toHaveBeenCalledWith(user, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');

    await billingController.create(user, {
      studentId: 'sp-1',
      type: 'UNIFORM',
      items: [],
    } as never);
    expect(billing.create).toHaveBeenCalled();

    await billingController.generateMonthly(user, { month: 10, year: 2026, classIds: ['c-1'] });
    expect(billing.generateMonthly).toHaveBeenCalledWith(user, {
      month: 10,
      year: 2026,
      classIds: ['c-1'],
    });

    await billingController.revenue(user, { from: '2026-01-01', to: '2026-12-31' });
    expect(billing.revenue).toHaveBeenCalledWith(
      user,
      new Date('2026-01-01'),
      new Date('2026-12-31'),
    );
  });

  it('delegates payment operations including the raw-body webhook', async () => {
    await paymentsController.createQrPayment(user, '3f2504e0-4f89-11d3-9a0c-0305e82c3301');
    expect(payments.createQrPayment).toHaveBeenCalledWith(
      user,
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );

    const req = {
      headers: { 'x-signature': 'sig' },
      rawBody: Buffer.from('{"orderRef":"VVABCD2345"}'),
    } as unknown as Request;
    await paymentsController.webhook('simulated', req);
    expect(payments.handleWebhook).toHaveBeenCalledWith(
      'simulated',
      req.headers,
      '{"orderRef":"VVABCD2345"}',
    );

    // A request that bypassed the json verify callback still verifies as empty.
    const bare = { headers: {} } as unknown as Request;
    await paymentsController.webhook('simulated', bare);
    expect(payments.handleWebhook).toHaveBeenCalledWith('simulated', bare.headers, '');

    await paymentsController.confirmCash(user, '3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
      note: 'ok',
    });
    expect(payments.confirmCash).toHaveBeenCalledWith(
      user,
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      'ok',
    );

    await paymentsController.setOutcome(user, '3f2504e0-4f89-11d3-9a0c-0305e82c3301', {
      status: 'REFUNDED',
    });
    expect(payments.setOutcome).toHaveBeenCalledWith(
      user,
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      'REFUNDED',
      undefined,
    );

    await paymentsController.listForInvoice(user, {
      invoiceId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    });
    expect(payments.listForInvoice).toHaveBeenCalledWith(
      user,
      '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
    );
  });
});
