import { ConfigService } from '@nestjs/config';
import { SealService } from './seal.service';
import { EnvService } from '../../config/env.service';
import type { Env } from '../../config/env.validation';

const KEY = 'ab'.repeat(32); // 64 hex chars = 32 bytes

function makeSealService(): SealService {
  const env = new EnvService(
    new ConfigService({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(64),
      APP_ENCRYPTION_KEY: KEY,
    }) as ConfigService<Env, true>,
  );
  return new SealService(env);
}

describe('SealService (AES-256-GCM)', () => {
  const service = makeSealService();

  it('round-trips a secret', () => {
    const plain = Buffer.from('TOTPSECRET123456');
    const sealed = service.seal(plain);
    expect(sealed.equals(plain)).toBe(false);
    expect(sealed.length).toBe(12 + plain.length + 16);
    expect(service.unseal(sealed).equals(plain)).toBe(true);
  });

  it('produces a fresh IV per call', () => {
    const plain = Buffer.from('same-plain-value');
    expect(service.seal(plain).equals(service.seal(plain))).toBe(false);
  });

  it('fails authentication on tampered ciphertext', () => {
    const sealed = service.seal(Buffer.from('secret'));
    const current = sealed[20] ?? 0;
    sealed[20] = current ^ 0xff;
    expect(() => service.unseal(sealed)).toThrow();
  });

  it('refuses to construct without a valid 64-hex key', () => {
    const env = new EnvService(
      new ConfigService({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        JWT_SECRET: 'a'.repeat(64),
      }) as ConfigService<Env, true>,
    );
    expect(() => new SealService(env)).toThrow(/APP_ENCRYPTION_KEY/);
  });
});
