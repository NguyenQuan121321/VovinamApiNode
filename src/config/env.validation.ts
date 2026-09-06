import Joi from 'joi';

export type NodeEnv = 'local' | 'test' | 'staging' | 'production';

export interface Env {
  NODE_ENV: NodeEnv;
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_SECRET_PREVIOUS?: string;
  JWT_ISSUER: string;
  ACCESS_TOKEN_TTL: string;
  REFRESH_TOKEN_TTL: string;
  /** 32-byte hex key sealing TOTP secrets (AES-256-GCM); required in production. */
  APP_ENCRYPTION_KEY?: string;
  MAX_LOGIN_ATTEMPTS: number;
  LOGIN_LOCKOUT_DURATION: string;
  RATE_LIMIT_TTL_SECONDS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  /** Parsed from a comma-separated env value into an origin allowlist. */
  CORS_ALLOWED_ORIGINS: string[];
  SWAGGER_ENABLED: boolean;
  METRICS_TOKEN?: string;
  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
  PAYOS_CLIENT_ID?: string;
  PAYOS_API_KEY?: string;
  PAYOS_CHECKSUM_KEY?: string;
  /** Which gateway adapter serves QR payments: payos | sepay | simulated. */
  PAYMENTS_GATEWAY?: string;
  /** HMAC-SHA256 secret verifying gateway webhooks (simulated adapter). */
  PAYMENTS_WEBHOOK_SECRET?: string;
  ZALO_OA_ACCESS_TOKEN?: string;
  ZALO_OA_APP_ID?: string;
  ZALO_OA_SECRET_KEY?: string;
  ESMS_API_KEY?: string;
  ESMS_SECRET_KEY?: string;
  ESMS_BRANDNAME?: string;
}

const optionalString = Joi.string().allow('').optional();

/**
 * Fail-fast boot contract (plan 11.1): a missing or malformed required variable blocks
 * startup. Optional integration credentials (SMTP, payOS, Zalo, eSMS) stay optional —
 * an absent key means the feature is disabled, never a fabricated default.
 */
export const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('local', 'test', 'staging', 'production').default('local'),
  PORT: Joi.number().integer().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().min(32).max(256).required(),
  JWT_SECRET_PREVIOUS: Joi.string().min(32).max(256).allow('').optional(),
  JWT_ISSUER: Joi.string().default('vovinam-api'),
  ACCESS_TOKEN_TTL: Joi.string().default('15m'),
  REFRESH_TOKEN_TTL: Joi.string().default('30d'),
  APP_ENCRYPTION_KEY: Joi.string()
    .hex()
    .length(64)
    .when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: optionalString }),
  MAX_LOGIN_ATTEMPTS: Joi.number().integer().min(1).max(20).default(5),
  LOGIN_LOCKOUT_DURATION: Joi.string().default('15m'),
  RATE_LIMIT_TTL_SECONDS: Joi.number().integer().min(1).default(60),
  RATE_LIMIT_MAX_REQUESTS: Joi.number().integer().min(1).default(100),
  CORS_ALLOWED_ORIGINS: Joi.string().allow('').default(''),
  SWAGGER_ENABLED: Joi.boolean().default(false),
  METRICS_TOKEN: Joi.string()
    .min(16)
    .when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: optionalString }),
  SMTP_HOST: optionalString,
  SMTP_PORT: Joi.number().integer().port().default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_FROM: optionalString,
  PAYOS_CLIENT_ID: optionalString,
  PAYOS_API_KEY: optionalString,
  PAYOS_CHECKSUM_KEY: optionalString,
  PAYMENTS_GATEWAY: Joi.string().valid('payos', 'sepay', 'simulated').default('simulated'),
  PAYMENTS_WEBHOOK_SECRET: Joi.string().min(16).allow('').optional(),
  ZALO_OA_ACCESS_TOKEN: optionalString,
  ZALO_OA_APP_ID: optionalString,
  ZALO_OA_SECRET_KEY: optionalString,
  ESMS_API_KEY: optionalString,
  ESMS_SECRET_KEY: optionalString,
  ESMS_BRANDNAME: optionalString,
}).unknown(true);

export function validateEnv(raw: Record<string, unknown>): Env {
  const { error, value } = envSchema.validate(raw, { abortEarly: false, convert: true });
  if (error) {
    const details = error.details.map((detail) => detail.message).join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const parsed = value as Omit<Env, 'CORS_ALLOWED_ORIGINS'> & { CORS_ALLOWED_ORIGINS: string };
  return {
    ...parsed,
    CORS_ALLOWED_ORIGINS: parsed.CORS_ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  };
}
