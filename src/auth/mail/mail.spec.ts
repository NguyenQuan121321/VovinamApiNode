import { LoggingMailSender } from './logging-mail.sender';
import { MAIL_PORT, type MailMessage } from './mail.port';

describe('MailPort', () => {
  it('logging sender records the notification without throwing', async () => {
    const sender = new LoggingMailSender({
      info: jest.fn(),
      error: jest.fn(),
    } as never);
    const message: MailMessage = {
      to: 'parent@example.com',
      subject: 'New login',
      body: 'A new device signed in',
      templateCode: 'NEW_IP_LOGIN',
    };
    await expect(sender.send(message)).resolves.toBeUndefined();
    expect(MAIL_PORT).toBeDefined();
  });
});
