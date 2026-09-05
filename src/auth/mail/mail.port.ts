export interface MailMessage {
  to: string;
  subject: string;
  body: string;
  templateCode: string;
}

export const MAIL_PORT = Symbol('MAIL_PORT');

/** Outbound mail boundary (plan 7.6); the SMTP/outbox adapters land in P5. */
export interface MailPort {
  send(message: MailMessage): Promise<void>;
}
