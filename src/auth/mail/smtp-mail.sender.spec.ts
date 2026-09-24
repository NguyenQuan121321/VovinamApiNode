import { createTransport, type Transporter } from 'nodemailer';
import { SmtpMailSender } from './smtp-mail.sender';
import type { EnvService } from '../../config/env.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

const createTransportMock = createTransport as jest.Mock;

function makeEnv(overrides: Partial<Record<string, unknown>> = {}): EnvService {
  return {
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: 'club@example.com',
    smtpPassword: 'secret-password',
    smtpFrom: 'no-reply@example.com',
    ...overrides,
  } as unknown as EnvService;
}

function makeLogger() {
  return { info: jest.fn(), error: jest.fn() } as never;
}

describe('SmtpMailSender', () => {
  let sendMail: jest.Mock;

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue(undefined);
    createTransportMock.mockReset().mockReturnValue({ sendMail } as unknown as Transporter);
  });

  it('builds the transport from validated SMTP configuration', () => {
    new SmtpMailSender(makeEnv(), makeLogger());
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'club@example.com', pass: 'secret-password' },
    });
  });

  it('uses implicit TLS for port 465 and omits auth when no credentials are set', () => {
    new SmtpMailSender(
      makeEnv({ smtpPort: 465, smtpUser: undefined, smtpPassword: undefined }),
      makeLogger(),
    );
    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
    });
  });

  it('delivers the message as text with the configured sender', async () => {
    const sender = new SmtpMailSender(makeEnv(), makeLogger());
    await sender.send({
      to: 'parent@example.com',
      subject: 'Verify your email',
      body: 'Use this token: abc123',
      templateCode: 'VERIFY_EMAIL',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'no-reply@example.com',
      to: 'parent@example.com',
      subject: 'Verify your email',
      text: 'Use this token: abc123',
    });
  });

  it('logs delivery without the message body (tokens are sensitive)', async () => {
    const logger = makeLogger() as { info: jest.Mock };
    const sender = new SmtpMailSender(makeEnv(), logger as never);
    await sender.send({
      to: 'parent@example.com',
      subject: 'Verify your email',
      body: 'Use this token: abc123',
      templateCode: 'VERIFY_EMAIL',
    });
    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).toContain('mail_sent');
    expect(logged).not.toContain('abc123');
  });

  it('never throws on delivery failure — notifications must not break the request path', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));
    const logger = makeLogger() as { error: jest.Mock };
    const sender = new SmtpMailSender(makeEnv(), logger as never);
    await expect(
      sender.send({
        to: 'parent@example.com',
        subject: 'New login',
        body: 'A new device signed in',
        templateCode: 'NEW_IP_LOGIN',
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'parent@example.com', err: 'SMTP connection refused' }),
      'mail_send_failed',
    );
  });
});
