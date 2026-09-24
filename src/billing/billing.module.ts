import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsModule } from '../students/students.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnvService } from '../config/env.service';
import { BillingController, PaymentsController } from './billing.controller';
import { BillingService } from './billing.service';
import { OverdueInvoiceJob } from './overdue-invoice.job';
import { PaymentsService } from './payments.service';
import { PayosGateway } from './payos.gateway';
import { PAYMENT_GATEWAY_PORT, type PaymentGatewayPort } from './payment-gateway.port';
import { SimulatedGateway } from './simulated.gateway';

/**
 * Invoices and payments (plan sections 6, 7.5, 7.7, 8). The QR gateway is chosen
 * by PAYMENTS_GATEWAY: 'simulated' for local/e2e runs; 'payos' is the primary
 * real channel (plan 7.5: exactly one). SePay was not selected — its adapter
 * stays fail-fast until the club ever decides to switch channels.
 */
export function createPaymentGateway(env: EnvService): PaymentGatewayPort {
  switch (env.paymentsGateway) {
    case 'simulated':
      return new SimulatedGateway(env);
    case 'payos':
      return new PayosGateway(env);
    case 'sepay':
      throw new Error(
        'No SePay adapter is implemented; the primary QR channel is payOS ' +
          '(PAYMENTS_GATEWAY=payos) or the simulated adapter for local runs',
      );
  }
}

@Module({
  imports: [AuthModule, StudentsModule, NotificationsModule],
  controllers: [BillingController, PaymentsController],
  providers: [
    BillingService,
    PaymentsService,
    OverdueInvoiceJob,
    {
      provide: PAYMENT_GATEWAY_PORT,
      inject: [EnvService],
      useFactory: createPaymentGateway,
    },
  ],
  exports: [BillingService],
})
export class BillingModule {}
