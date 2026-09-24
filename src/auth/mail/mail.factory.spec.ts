import { createMailSender } from './mail.factory';
import { LoggingMailSender } from './logging-mail.sender';
import { SmtpMailSender } from './smtp-mail.sender';
import type { EnvService } from '../../config/env.service';
import type { Logger } from 'pino';

function makeEnv(mailDriver: string): EnvService {
  return { mailDriver } as unknown as EnvService;
}

const logger = { info: jest.fn() } as unknown as Logger;

describe('createMailSender (MAIL_PORT adapter selection)', () => {
  it('keeps the logging sender as the default (local/e2e token capture)', () => {
    expect(createMailSender(makeEnv('logging'), logger)).toBeInstanceOf(LoggingMailSender);
  });

  it('selects the SMTP sender when MAIL_DRIVER=smtp', () => {
    expect(createMailSender(makeEnv('smtp'), logger)).toBeInstanceOf(SmtpMailSender);
  });
});
