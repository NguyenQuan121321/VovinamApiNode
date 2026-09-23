import { NotificationsModule } from './notifications.module';

describe('NotificationsModule', () => {
  const unconfiguredEnv = { znsConfigured: false, smsConfigured: false };

  it('boots when ZNS/eSMS credentials are absent (EMAIL fallback is the default)', () => {
    expect(() => new NotificationsModule(unconfiguredEnv as never)).not.toThrow();
  });

  it('fails fast when ZNS credentials exist but no real ZNS adapter is implemented', () => {
    expect(
      () => new NotificationsModule({ ...unconfiguredEnv, znsConfigured: true } as never),
    ).toThrow('Zalo OA / eSMS credentials are set but the real ZNS/SMS senders are not');
  });

  it('fails fast when eSMS credentials exist but no real SMS adapter is implemented', () => {
    expect(
      () => new NotificationsModule({ ...unconfiguredEnv, smsConfigured: true } as never),
    ).toThrow('Zalo OA / eSMS credentials are set but the real ZNS/SMS senders are not');
  });
});
