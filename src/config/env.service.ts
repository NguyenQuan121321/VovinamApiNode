import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env, NodeEnv } from './env.validation';

/**
 * Typed, validated access to the environment. Reads are restricted to the keys of
 * {@link Env} so a typo fails at compile time and an unvalidated variable can never
 * reach application code.
 */
@Injectable()
export class EnvService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv(): NodeEnv {
    return this.get('NODE_ENV');
  }

  get port(): number {
    return this.get('PORT');
  }

  get databaseUrl(): string {
    return this.get('DATABASE_URL');
  }

  get jwtSecret(): string {
    return this.get('JWT_SECRET');
  }

  get jwtSecretPrevious(): string | undefined {
    return this.getOptional('JWT_SECRET_PREVIOUS');
  }

  get jwtIssuer(): string {
    return this.get('JWT_ISSUER');
  }

  get accessTokenTtl(): string {
    return this.get('ACCESS_TOKEN_TTL');
  }

  get refreshTokenTtl(): string {
    return this.get('REFRESH_TOKEN_TTL');
  }

  get appEncryptionKey(): string | undefined {
    return this.getOptional('APP_ENCRYPTION_KEY');
  }

  get maxLoginAttempts(): number {
    return this.get('MAX_LOGIN_ATTEMPTS');
  }

  get loginLockoutDuration(): string {
    return this.get('LOGIN_LOCKOUT_DURATION');
  }

  get rateLimitTtlSeconds(): number {
    return this.get('RATE_LIMIT_TTL_SECONDS');
  }

  get rateLimitMaxRequests(): number {
    return this.get('RATE_LIMIT_MAX_REQUESTS');
  }

  get corsOrigins(): string[] {
    return this.get('CORS_ALLOWED_ORIGINS');
  }

  get swaggerEnabled(): boolean {
    return this.get('SWAGGER_ENABLED');
  }

  get metricsToken(): string | undefined {
    return this.getOptional('METRICS_TOKEN');
  }

  /** payos | sepay | simulated — QR payments are config-gated (plan stop rules). */
  get paymentsGateway(): 'payos' | 'sepay' | 'simulated' {
    // Joi validates the value; the assertion only narrows the string type.
    return this.get('PAYMENTS_GATEWAY') as 'payos' | 'sepay' | 'simulated';
  }

  get paymentsWebhookSecret(): string | undefined {
    return this.getOptional('PAYMENTS_WEBHOOK_SECRET');
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  private get<K extends keyof Env>(key: K): Env[K] {
    const value: Env[K] | undefined = this.config.get(key, { infer: true });
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing validated environment variable: ${String(key)}`);
    }
    return value;
  }

  private getOptional<K extends keyof Env>(key: K): Env[K] | undefined {
    const value: Env[K] | undefined = this.config.get(key, { infer: true });
    return value === '' ? undefined : value;
  }
}
