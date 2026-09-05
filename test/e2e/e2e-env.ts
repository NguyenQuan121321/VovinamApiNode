import 'reflect-metadata';

// createApp() reads the environment when the AppModule decorator is evaluated at
// import time (ConfigModule.forRoot validate), i.e. BEFORE any test hook runs —
// so e2e environment defaults must live in this setupFiles script, never inside
// beforeAll. DATABASE_URL is intentionally not defaulted: e2e needs a real Postgres.
process.env.NODE_ENV ??= 'test';
process.env.SWAGGER_ENABLED = 'true';
process.env.METRICS_TOKEN ??= 'e2e-metrics-token-0123456789';
process.env.JWT_SECRET ??= 'e2e-jwt-secret-0123456789abcdef0123456789abcdef';
