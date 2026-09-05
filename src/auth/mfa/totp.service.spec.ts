import type { Logger } from 'pino';
import { authenticator } from 'otplib';
import { InMemorySharedStore } from '../../common/shared-store';
import { TotpService, generateRecoveryCodes } from './totp.service';

describe('TotpService', () => {
  let service: TotpService;
  let store: InMemorySharedStore;

  beforeEach(() => {
    store = new InMemorySharedStore();
    service = new TotpService(store, { warn: jest.fn() } as unknown as Logger);
  });

  it('creates an enrollment with a valid otpauth URL', async () => {
    const enrollment = await service.createEnrollment('parent@example.com');
    expect(enrollment.otpauthUrl).toContain('totp/VovinamApiNode:parent%40example.com');
    expect(enrollment.qrDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('stashes and takes the pending secret exactly once', () => {
    service.stashPendingSecret('u-1', 'SECRET22');
    expect(service.takePendingSecret('u-1')).toBe('SECRET22');
    expect(service.takePendingSecret('u-1')).toBeUndefined();
  });

  it('verifies a correct code and rejects a wrong one', () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    expect(service.verifyCode('u-1', secret, code)).toBe(true);
    expect(service.verifyCode('u-1', secret, '000000')).toBe(false);
  });

  it('accepts ±1 step skew but not more', () => {
    const secret = authenticator.generateSecret();
    const nowMs = Date.now();
    const prevCode = authenticator
      .create({ ...authenticator.options, window: 0, epoch: nowMs - 31_000 })
      .generate(secret);
    expect(service.verifyCode('u-1', secret, prevCode)).toBe(true);
    const farCode = authenticator
      .create({ ...authenticator.options, window: 0, epoch: nowMs - 95_000 })
      .generate(secret);
    expect(service.verifyCode('u-2', secret, farCode)).toBe(false);
  });

  it('blocks a replayed code within the 120s guard', () => {
    const secret = authenticator.generateSecret();
    const code = authenticator.generate(secret);
    expect(service.verifyCode('u-1', secret, code)).toBe(true);
    expect(service.verifyCode('u-1', secret, code)).toBe(false);
  });

  it('shares ONE failure bucket across codes: 5 failures lock the path (S-05)', () => {
    const secret = authenticator.generateSecret();
    for (let i = 0; i < 4; i += 1) {
      expect(service.verifyCode('u-1', secret, '000000')).toBe(false);
    }
    // The 5th failure trips the shared bucket and locks the path.
    expect(() => service.verifyCode('u-1', secret, '000000')).toThrow(
      /Too many verification attempts/,
    );
    // Even a CORRECT code is now rejected by the shared bucket.
    const code = authenticator.generate(secret);
    expect(() => service.verifyCode('u-1', secret, code)).toThrow(/Too many verification attempts/);
  });

  it('generates the requested number of unique recovery codes', () => {
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
