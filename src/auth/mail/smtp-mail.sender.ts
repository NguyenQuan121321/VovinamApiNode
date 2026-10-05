import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import { EnvService } from '../../config/env.service';
import { APP_LOGGER } from '../../logging/pino-logger.factory';
import type { MailMessage, MailPort } from './mail.port';

/**
 * Deliverable mail adapter (plan 7.6) behind MAIL_PORT, selected by
 * MAIL_DRIVER=smtp. Failures propagate to the caller: the outbox retries,
 * while authentication's notification boundary preserves its response posture.
 * Recipients, message bodies and provider errors never enter logs.
 */
@Injectable()
export class SmtpMailSender implements MailPort {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(
    env: EnvService,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {
    this.from = env.smtpFrom;
    this.transporter = createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      ...(env.smtpUser !== undefined && env.smtpPassword !== undefined
        ? { auth: { user: env.smtpUser, pass: env.smtpPassword } }
        : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
      this.logger.info({ template: message.templateCode }, 'mail_sent');
    } catch {
      this.logger.error({ template: message.templateCode }, 'mail_send_failed');
      throw new Error('Mail delivery failed');
    }
  }
}
