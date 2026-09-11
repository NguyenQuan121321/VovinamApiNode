import { OverdueInvoiceJob } from './overdue-invoice.job';
import { PrismaService } from '../prisma/prisma.service';

describe('OverdueInvoiceJob', () => {
  it('flips only UNPAID invoices past their due date to OVERDUE', async () => {
    const prisma = { invoice: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) } };
    const job = new OverdueInvoiceJob(prisma as unknown as PrismaService);
    await job.onModuleInit();
    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { status: 'UNPAID', dueDate: { lt: expect.any(Date) } },
      data: { status: 'OVERDUE' },
    });
  });

  it('swallows failures so the next daily interval retries', async () => {
    const prisma = { invoice: { updateMany: jest.fn().mockRejectedValue(new Error('db down')) } };
    const job = new OverdueInvoiceJob(prisma as unknown as PrismaService);
    await expect(job.onModuleInit()).resolves.toBeUndefined();
  });
});
