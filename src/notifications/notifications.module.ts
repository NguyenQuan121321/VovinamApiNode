import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EnvService } from '../config/env.service';
import { NotificationsController } from './notifications.controller';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationsService } from './notifications.service';
import { SMS_SENDER_PORT, ZNS_SENDER_PORT } from './notification-senders.port';
import { SmsStubSender, ZnsStubSender } from './stub-senders';

/**
 * Notification outbox + in-app feed (plan 7.6, 8). The MAIL_PORT comes from
 * AuthModule (currently the logging sender; the SMTP adapter lands with the
 * club's SMTP credentials). ZNS/eSMS senders are stubs until those credentials
 * exist — the worker falls back to EMAIL instead of failing (plan stop rules:
 * no fabricated sends, no fail-fast boot on an unconfigured optional channel).
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationOutboxService,
    NotificationsService,
    { provide: ZNS_SENDER_PORT, useClass: ZnsStubSender },
    { provide: SMS_SENDER_PORT, useClass: SmsStubSender },
  ],
  exports: [NotificationOutboxService],
})
export class NotificationsModule {
  constructor(private readonly env: EnvService) {
    // Fail fast ONLY when credentials exist but no real adapter does — the same
    // rule as the payos/sepay payment gateways. Absent credentials are fine:
    // delivery falls back to EMAIL.
    if (this.env.znsConfigured || this.env.smsConfigured) {
      throw new Error(
        'Zalo OA / eSMS credentials are set but the real ZNS/SMS senders are not ' +
          'implemented yet; remove the credentials or implement the adapters first',
      );
    }
  }
}
