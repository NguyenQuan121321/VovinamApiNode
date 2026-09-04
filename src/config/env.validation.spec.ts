import { validateEnv } from './env.validation';

const valid: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
};

describe('validateEnv', () => {
  it('applies defaults and parses the CORS allowlist', () => {
    const env = validateEnv({
      ...valid,
      CORS_ALLOWED_ORIGINS: 'https://app.example.com, https://admin.example.com',
    });
    expect(env.NODE_ENV).toBe('local');
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ISSUER).toBe('vovinam-api');
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('rejects missing required variables', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/JWT_SECRET/);
  });

  it('rejects weak JWT secrets', () => {
    expect(() => validateEnv({ ...valid, JWT_SECRET: 'too-short' })).toThrow(/JWT_SECRET/);
  });

  it('requires APP_ENCRYPTION_KEY and METRICS_TOKEN in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/APP_ENCRYPTION_KEY/);
    expect(() =>
      validateEnv({ ...valid, NODE_ENV: 'production', APP_ENCRYPTION_KEY: 'z'.repeat(64) }),
    ).toThrow(/METRICS_TOKEN/);
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_ENCRYPTION_KEY: 'a'.repeat(64),
        METRICS_TOKEN: 'tokentokentoken12',
      }),
    ).not.toThrow();
  });

  it('rejects a malformed APP_ENCRYPTION_KEY', () => {
    expect(() =>
      validateEnv({ ...valid, NODE_ENV: 'production', APP_ENCRYPTION_KEY: 'not-hex-'.repeat(8) }),
    ).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('empty CORS string yields an empty allowlist', () => {
    expect(validateEnv({ ...valid, CORS_ALLOWED_ORIGINS: '' }).CORS_ALLOWED_ORIGINS).toEqual([]);
  });
});
