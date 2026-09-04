import { ConfigService } from '@nestjs/config';
import { AppConfigModule } from './app-config.module';
import { EnvService } from './env.service';
import type { Env } from './env.validation';

function makeEnvService(values: Record<string, unknown>): EnvService {
  return new EnvService(new ConfigService(values) as ConfigService<Env, true>);
}

const base: Record<string, unknown> = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  JWT_SECRET: '0123456789abcdef0123456789abcdef',
  JWT_SECRET_PREVIOUS: '',
  JWT_ISSUER: 'vovinam-api',
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '30d',
  APP_ENCRYPTION_KEY: '',
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_LOCKOUT_DURATION: '15m',
  RATE_LIMIT_TTL_SECONDS: 60,
  RATE_LIMIT_MAX_REQUESTS: 100,
  CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
  SWAGGER_ENABLED: false,
  METRICS_TOKEN: '',
};

describe('EnvService', () => {
  it('exposes typed parsed values', () => {
    const service = makeEnvService(base);
    expect(service.nodeEnv).toBe('test');
    expect(service.port).toBe(3000);
    expect(service.databaseUrl).toBe(base.DATABASE_URL);
    expect(service.jwtSecret).toBe(base.JWT_SECRET);
    expect(service.jwtIssuer).toBe('vovinam-api');
    expect(service.accessTokenTtl).toBe('15m');
    expect(service.refreshTokenTtl).toBe('30d');
    expect(service.maxLoginAttempts).toBe(5);
    expect(service.loginLockoutDuration).toBe('15m');
    expect(service.rateLimitTtlSeconds).toBe(60);
    expect(service.rateLimitMaxRequests).toBe(100);
    expect(service.corsOrigins).toEqual(['http://localhost:5173']);
    expect(service.swaggerEnabled).toBe(false);
    expect(service.isProduction).toBe(false);
  });

  it('treats empty optional variables as undefined', () => {
    const service = makeEnvService(base);
    expect(service.jwtSecretPrevious).toBeUndefined();
    expect(service.appEncryptionKey).toBeUndefined();
    expect(service.metricsToken).toBeUndefined();
  });

  it('throws when a required variable is missing', () => {
    const service = makeEnvService({ ...base, JWT_SECRET: undefined });
    expect(() => service.jwtSecret).toThrow(/JWT_SECRET/);
  });

  it('reports production mode', () => {
    const service = makeEnvService({ ...base, NODE_ENV: 'production' });
    expect(service.isProduction).toBe(true);
  });

  it('app config module stays loadable', () => {
    expect(new AppConfigModule()).toBeDefined();
  });
});
