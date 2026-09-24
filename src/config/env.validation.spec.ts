import { validateEnv } from './env.validation';

const valid: Record<string, unknown> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
  // PAYMENTS_GATEWAY defaults to simulated, which requires the webhook secret.
  PAYMENTS_WEBHOOK_SECRET: 'e2e-payments-webhook-secret-0123456789',
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
        // Production also demands an explicit real gateway (simulated is forbidden).
        PAYMENTS_GATEWAY: 'payos',
        PAYOS_CLIENT_ID: 'id',
        PAYOS_API_KEY: 'key',
        PAYOS_CHECKSUM_KEY: 'checksum',
        PAYOS_RETURN_URL: 'https://app.example.com/return',
        PAYOS_CANCEL_URL: 'https://app.example.com/cancel',
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

  it('MAIL_DRIVER=smtp requires SMTP_HOST and SMTP_FROM (fail-fast mail wiring)', () => {
    expect(() => validateEnv({ ...valid, MAIL_DRIVER: 'smtp' })).toThrow(/SMTP_HOST/);
    expect(() =>
      validateEnv({ ...valid, MAIL_DRIVER: 'smtp', SMTP_HOST: 'smtp.example.com' }),
    ).toThrow(/SMTP_FROM/);
    expect(() =>
      validateEnv({
        ...valid,
        MAIL_DRIVER: 'smtp',
        SMTP_HOST: 'smtp.example.com',
        SMTP_FROM: 'no-reply@example.com',
      }),
    ).not.toThrow();
    expect(validateEnv({ ...valid }).MAIL_DRIVER).toBe('logging');
  });

  it('rejects an unknown MAIL_DRIVER', () => {
    expect(() => validateEnv({ ...valid, MAIL_DRIVER: 'carrier-pigeon' })).toThrow(/MAIL_DRIVER/);
  });

  it('PAYMENTS_GATEWAY=payos requires the credentials and checkout redirect URLs', () => {
    expect(() => validateEnv({ ...valid, PAYMENTS_GATEWAY: 'payos' })).toThrow(/PAYOS_CLIENT_ID/);
    expect(() =>
      validateEnv({
        ...valid,
        PAYMENTS_GATEWAY: 'payos',
        PAYOS_CLIENT_ID: 'id',
        PAYOS_API_KEY: 'key',
        PAYOS_CHECKSUM_KEY: 'checksum',
      }),
    ).toThrow(/PAYOS_RETURN_URL/);
    expect(() =>
      validateEnv({
        ...valid,
        PAYMENTS_GATEWAY: 'payos',
        PAYOS_CLIENT_ID: 'id',
        PAYOS_API_KEY: 'key',
        PAYOS_CHECKSUM_KEY: 'checksum',
        PAYOS_RETURN_URL: 'https://app.example.com/return',
        PAYOS_CANCEL_URL: 'not a url',
      }),
    ).toThrow(/PAYOS_CANCEL_URL/);
    expect(() =>
      validateEnv({
        ...valid,
        PAYMENTS_GATEWAY: 'payos',
        PAYOS_CLIENT_ID: 'id',
        PAYOS_API_KEY: 'key',
        PAYOS_CHECKSUM_KEY: 'checksum',
        PAYOS_RETURN_URL: 'https://app.example.com/return',
        PAYOS_CANCEL_URL: 'https://app.example.com/cancel',
      }),
    ).not.toThrow();
  });

  it('forbids the simulated gateway in production (audit I-3/J-3)', () => {
    const prodBase = {
      ...valid,
      NODE_ENV: 'production',
      APP_ENCRYPTION_KEY: 'a'.repeat(64),
      METRICS_TOKEN: 'tokentokentoken12',
    };
    expect(() => validateEnv(prodBase)).toThrow(/PAYMENTS_GATEWAY/);
    expect(() => validateEnv({ ...prodBase, PAYMENTS_GATEWAY: 'simulated' })).toThrow(
      /PAYMENTS_GATEWAY/,
    );
    // payOS remains a legal production channel (checksum key still required).
    expect(() =>
      validateEnv({
        ...prodBase,
        PAYMENTS_GATEWAY: 'payos',
        PAYOS_CLIENT_ID: 'id',
        PAYOS_API_KEY: 'key',
        PAYOS_CHECKSUM_KEY: 'checksum',
        PAYOS_RETURN_URL: 'https://app.example.com/return',
        PAYOS_CANCEL_URL: 'https://app.example.com/cancel',
      }),
    ).not.toThrow();
  });

  it('requires the webhook secret whenever the simulated gateway is selected', () => {
    expect(() => validateEnv({ ...valid, PAYMENTS_WEBHOOK_SECRET: '' })).toThrow(
      /PAYMENTS_WEBHOOK_SECRET/,
    );
    expect(() => validateEnv({ ...valid, PAYMENTS_WEBHOOK_SECRET: 'short' })).toThrow(
      /PAYMENTS_WEBHOOK_SECRET/,
    );
    // A real gateway verifies webhooks with its own credentials instead.
    expect(() =>
      validateEnv({
        ...valid,
        PAYMENTS_GATEWAY: 'payos',
        PAYOS_CLIENT_ID: 'id',
        PAYOS_API_KEY: 'key',
        PAYOS_CHECKSUM_KEY: 'checksum',
        PAYOS_RETURN_URL: 'https://app.example.com/return',
        PAYOS_CANCEL_URL: 'https://app.example.com/cancel',
        PAYMENTS_WEBHOOK_SECRET: '',
      }),
    ).not.toThrow();
  });

  it('forbids MAIL_LOG_FILE in production (audit P3-4: token-bearing mail dump)', () => {
    expect(() => validateEnv({ ...valid, MAIL_LOG_FILE: '/tmp/mail.log' })).not.toThrow();
    expect(() =>
      validateEnv({
        ...valid,
        NODE_ENV: 'production',
        APP_ENCRYPTION_KEY: 'a'.repeat(64),
        METRICS_TOKEN: 'tokentokentoken12',
        PAYMENTS_GATEWAY: 'payos',
        PAYOS_CLIENT_ID: 'id',
        PAYOS_API_KEY: 'key',
        PAYOS_CHECKSUM_KEY: 'checksum',
        PAYOS_RETURN_URL: 'https://app.example.com/return',
        PAYOS_CANCEL_URL: 'https://app.example.com/cancel',
        MAIL_LOG_FILE: '/tmp/mail.log',
      }),
    ).toThrow(/MAIL_LOG_FILE/);
  });
});
