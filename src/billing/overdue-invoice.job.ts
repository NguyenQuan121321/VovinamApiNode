import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const OVERDUE_CHECK_INTERVAL_MS = 24 * 3_600_000;

/**
 * Daily invoice aging (plan 7.5): UNPAID invoices past their due date become
 * OVERDUE. PAID/CANCELLED/REFUNDED invoices are never touched, and the flip is
 * one-way — settlements only ever move OVERDUE to PAID.
 */
@Injectable()
export class OverdueInvoiceJob implements OnModuleInit {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.markOverdue();
    this.timer = setInterval(() => void this.markOverdue(), OVERDUE_CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  private async markOverdue(): Promise<void> {
    try {
      await this.prisma.invoice.updateMany({
        where: { status: 'UNPAID', dueDate: { lt: new Date() } },
        data: { status: 'OVERDUE' },
      });
    } catch {
      // Aging is opportunistic; the next daily interval retries.
    }
  }
}
