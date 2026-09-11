import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { EnvService } from '../config/env.service';
import { BillingController, PaymentsController } from './billing.controller';
import { BillingService } from './billing.service';
import { OverdueInvoiceJob } from './overdue-invoice.job';
import { PaymentsService } from './payments.service';
import { PAYMENT_GATEWAY_PORT } from './payment-gateway.port';
import { SimulatedGateway } from './simulated.gateway';

/**
 * Invoices and payments (plan sections 6, 7.5, 7.7, 8). The QR gateway is chosen
 * by PAYMENTS_GATEWAY: 'simulated' for local/e2e runs; 'payos'/'sepay' adapters
 * land together with their real credentials (fail-fast boot until then).
 */
@Module({
  imports: [AuthModule, StudentsModule],
  controllers: [BillingController, PaymentsController],
  providers: [
    BillingService,
    PaymentsService,
    OverdueInvoiceJob,
    {
      provide: PAYMENT_GATEWAY_PORT,
      inject: [EnvService],
      useFactory: (env: EnvService) => {
        switch (env.paymentsGateway) {
          case 'simulated':
            return new SimulatedGateway(env);
          case 'payos':
          case 'sepay':
            throw new Error(
              `The ${env.paymentsGateway} gateway adapter is not implemented yet; ` +
                'set PAYMENTS_GATEWAY=simulated until its credentials arrive',
            );
        }
      },
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
