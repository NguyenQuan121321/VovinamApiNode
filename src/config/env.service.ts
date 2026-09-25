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

  get authIpLimitMax(): number {
    return this.get('AUTH_IP_LIMIT_MAX');
  }

  get authIpLimitTtlSeconds(): number {
    return this.get('AUTH_IP_LIMIT_TTL_SECONDS');
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

  /** logging | smtp — selects the MAIL_PORT adapter (auth mail factory). */
  get mailDriver(): 'logging' | 'smtp' {
    // Joi validates the value; the assertion only narrows the string type.
    return this.get('MAIL_DRIVER') as 'logging' | 'smtp';
  }

  get smtpHost(): string {
    // Required by validation when MAIL_DRIVER=smtp; the getter fails fast if miswired.
    return this.get('SMTP_HOST') as string;
  }

  get smtpPort(): number {
    return this.get('SMTP_PORT');
  }

  get smtpUser(): string | undefined {
    return this.getOptional('SMTP_USER');
  }

  get smtpPassword(): string | undefined {
    return this.getOptional('SMTP_PASSWORD');
  }

  get smtpFrom(): string {
    // Required by validation when MAIL_DRIVER=smtp; the getter fails fast if miswired.
    return this.get('SMTP_FROM') as string;
  }

  get payosClientId(): string {
    // Required by validation when PAYMENTS_GATEWAY=payos.
    return this.get('PAYOS_CLIENT_ID') as string;
  }

  get payosApiKey(): string {
    return this.get('PAYOS_API_KEY') as string;
  }

  get payosChecksumKey(): string {
    return this.get('PAYOS_CHECKSUM_KEY') as string;
  }

  get payosReturnUrl(): string {
    return this.get('PAYOS_RETURN_URL') as string;
  }

  get payosCancelUrl(): string {
    return this.get('PAYOS_CANCEL_URL') as string;
  }

  /** payos | sepay | simulated — QR payments are config-gated (plan stop rules). */
  get paymentsGateway(): 'payos' | 'sepay' | 'simulated' {
    // Joi validates the value; the assertion only narrows the string type.
    return this.get('PAYMENTS_GATEWAY') as 'payos' | 'sepay' | 'simulated';
  }

  get paymentsWebhookSecret(): string | undefined {
    return this.getOptional('PAYMENTS_WEBHOOK_SECRET');
  }

  /** Zalo OA credentials present (plan 7.6): the ZNS sender is considered configured. */
  get znsConfigured(): boolean {
    return (
      this.getOptional('ZALO_OA_ACCESS_TOKEN') !== undefined &&
      this.getOptional('ZALO_OA_APP_ID') !== undefined &&
      this.getOptional('ZALO_OA_SECRET_KEY') !== undefined
    );
  }

  /** eSMS credentials present (plan 7.6): the SMS fallback sender is considered configured. */
  get smsConfigured(): boolean {
    return (
      this.getOptional('ESMS_API_KEY') !== undefined &&
      this.getOptional('ESMS_SECRET_KEY') !== undefined &&
      this.getOptional('ESMS_BRANDNAME') !== undefined
    );
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
