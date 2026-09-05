import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BillingService } from './billing.service';

/**
 * Invoice issuance for the exam flow (plan sections 6, 8). Full billing surface —
 * invoice endpoints, payments/QR/webhooks, generate-monthly, revenue report —
 * lands in P4 (plan section 7.5, 7.7).
 */
@Module({
  imports: [AuthModule],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
