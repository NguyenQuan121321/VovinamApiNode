import { Prisma } from '@prisma/client';
import { BillingService, type Tx } from './billing.service';
import { AuditService } from '../auth/audit/audit.service';

const exam = {
  code: 'EXAM-2026-03',
  title: 'Mid-term grading',
  feeAmount: 300000,
  examDate: new Date('2026-03-20'),
};

function makeTx() {
  return {
    invoice: { findFirst: jest.fn(), create: jest.fn() },
    invoiceItem: { create: jest.fn() },
  };
}

type TxMock = ReturnType<typeof makeTx>;

function makeService() {
  const audit = { record: jest.fn() };
  const service = new BillingService(audit as unknown as AuditService);
  return { service, auditRecord: audit.record as jest.Mock };
}

describe('BillingService (exam fee invoices, P3 slice)', () => {
  let tx: TxMock;
  let service: BillingService;
  let auditRecord: jest.Mock;

  beforeEach(() => {
    tx = makeTx();
    ({ service, auditRecord } = makeService());
  });

  it('issues a sequential invoice with one correct line item', async () => {
    tx.invoice.findFirst.mockResolvedValue({ invoiceNo: 'INV-2026-0007' });
    tx.invoice.create.mockImplementation(({ data }: { data: { invoiceNo: string } }) =>
      Promise.resolve({
        id: 'inv-1',
        invoiceNo: data.invoiceNo,
        total: exam.feeAmount,
        status: 'UNPAID',
      }),
    );

    const invoice = await service.createExamFeeInvoice(tx as unknown as Tx, {
      studentId: 'sp-1',
      exam,
      examRegistrationId: 'reg-1',
      createdBy: 'admin-1',
    });
    expect(invoice).toMatchObject({ invoiceNo: 'INV-2026-0008', total: 300000, status: 'UNPAID' });
    const data = tx.invoice.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      type: 'EXAM_FEE',
      subtotal: 300000,
      total: 300000,
      discount: 0,
      refExamRegistrationId: 'reg-1',
      studentId: 'sp-1',
    });
    const item = tx.invoiceItem.create.mock.calls[0][0].data;
    expect(item).toMatchObject({ quantity: 1, unitAmount: 300000, amount: 300000 });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'invoice_issued', success: true }),
    );
  });

  it('starts the yearly sequence at 0001 when no invoice exists yet', async () => {
    tx.invoice.findFirst.mockResolvedValue(null);
    tx.invoice.create.mockResolvedValue({
      id: 'inv-1',
      invoiceNo: 'INV-2026-0001',
      total: 1,
      status: 'UNPAID',
    });
    const invoice = await service.createExamFeeInvoice(tx as unknown as Tx, {
      studentId: 'sp-1',
      exam,
      examRegistrationId: 'reg-1',
      createdBy: 'admin-1',
    });
    expect(invoice.invoiceNo).toBe('INV-2026-0001');
  });

  it('retries on a conflicting invoice_no and then succeeds', async () => {
    tx.invoice.findFirst.mockResolvedValue({ invoiceNo: 'INV-2026-0002' });
    tx.invoice.create
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
    const invoice = await service.createExamFeeInvoice(tx as unknown as Tx, {
      studentId: 'sp-1',
      exam,
      examRegistrationId: 'reg-1',
      createdBy: 'admin-1',
    });
    expect(invoice.invoiceNo).toBe('INV-2026-0003');
    expect(tx.invoice.create).toHaveBeenCalledTimes(2);
  });
});
