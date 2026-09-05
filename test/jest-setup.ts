import 'reflect-metadata';

// createApp() reads the environment when the AppModule decorator is evaluated at
// import time (ConfigModule.forRoot validate), i.e. BEFORE any test hook runs —
// so e2e overrides must live in this setupFiles script, never inside beforeAll.
process.env.NODE_ENV ??= 'test';
process.env.SWAGGER_ENABLED = 'true';
process.env.METRICS_TOKEN ??= 'e2e-metrics-token-0123456789';
