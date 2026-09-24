import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import { EnvService } from '../../config/env.service';
import { APP_LOGGER } from '../../logging/pino-logger.factory';
import type { MailMessage, MailPort } from './mail.port';

/**
 * Deliverable mail adapter (plan 7.6) behind MAIL_PORT, selected by
 * MAIL_DRIVER=smtp. Delivery problems are logged, never thrown — the same
 * contract as LoggingMailSender, because security-relevant notifications
 * (new-IP login, token reuse, lockout) must not fail the request path. Message
 * bodies carry single-use tokens and are therefore never logged.
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
      this.logger.info(
        { to: message.to, template: message.templateCode, subject: message.subject },
        'mail_sent',
      );
    } catch (error) {
      this.logger.error(
        {
          to: message.to,
          template: message.templateCode,
          err: error instanceof Error ? error.message : 'unknown error',
        },
        'mail_send_failed',
      );
    }
  }
}
