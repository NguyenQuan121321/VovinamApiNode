import { readFileSync } from 'node:fs';
import type { MailMessage } from '../../../src/auth/mail/mail.port';

/** Reads the mail log file produced by LoggingMailSender (MAIL_LOG_FILE). */
export function readMailLog(path: string): MailMessage[] {
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as MailMessage);
  } catch {
    return [];
  }
}

/** Extracts the single-use action token mailed for a given address and template. */
export function extractToken(mails: MailMessage[], to: string, templateCode: string): string {
  const matches = mails
    .filter((mail) => mail.to === to && mail.templateCode === templateCode)
    .map((mail) => /token[^:]*:\s*(\S+)/.exec(mail.body)?.[1])
    .filter((token): token is string => token !== undefined);
  const last = matches.at(-1);
  if (last === undefined) {
    throw new Error(`No ${templateCode} token mailed to ${to}`);
  }
  return last;
}
