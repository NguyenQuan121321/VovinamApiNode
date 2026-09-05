import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../logging/pino-logger.factory';
import type { MailMessage, MailPort } from './mail.port';

/**
 * Placeholder sender until the P5 outbox + SMTP adapter exist. Security-relevant
 * notifications (new-IP login, token reuse, lockout) must never fail the request
 * path, so delivery problems are logged, never thrown.
 */
@Injectable()
export class LoggingMailSender implements MailPort {
  constructor(@Inject(APP_LOGGER) private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info(
      { to: message.to, template: message.templateCode, subject: message.subject },
      'mail_logged_not_sent',
    );
  }
}
