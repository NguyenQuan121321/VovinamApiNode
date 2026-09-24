import type { Logger } from 'pino';
import type { EnvService } from '../../config/env.service';
import { LoggingMailSender } from './logging-mail.sender';
import { SmtpMailSender } from './smtp-mail.sender';
import type { MailPort } from './mail.port';

/**
 * MAIL_PORT adapter selection (plan 7.6): MAIL_DRIVER=smtp delivers through
 * nodemailer; the default 'logging' keeps the local/e2e behavior where e2e
 * captures out-of-band tokens via MAIL_LOG_FILE.
 */
export function createMailSender(env: EnvService, logger: Logger): MailPort {
  return env.mailDriver === 'smtp'
    ? new SmtpMailSender(env, logger)
    : new LoggingMailSender(logger);
}
