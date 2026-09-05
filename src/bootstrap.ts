import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import type { Express } from 'express';
import { AppModule } from './app.module';
import { EnvService } from './config/env.service';
import { PinoLoggerService } from './logging/pino-logger.service';

/** Single source of the OpenAPI contract (used by bootstrap and scripts/generate-openapi.ts). */
export function buildOpenApiDocumentConfig() {
  return new DocumentBuilder()
    .setTitle('VovinamApiNode')
    .setDescription('Vovinam club management API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
}

// Swagger UI inlines scripts/styles and may load assets from a CDN; production keeps
// SWAGGER_ENABLED=false so this relaxed CSP only ever applies in dev/staging.
function swaggerCsp() {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://unpkg.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://unpkg.com'],
    imgSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net', 'https://unpkg.com'],
    fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net', 'https://unpkg.com'],
    workerSrc: ["'self'", 'blob:'],
  };
}

/**
 * Shared app factory used by main.ts AND the e2e suite so tests exercise the exact
 * production wiring (envelope, filters, helmet, pipes, prefix, Swagger gating).
 */
export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], bodyParser: false });
  const env = app.get(EnvService);

  app.useLogger(app.get(PinoLoggerService));
  // Trust the first proxy hop (Render/nginx) so client IPs for rate limiting are real.
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);

  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));
  app.use(
    helmet({
      contentSecurityPolicy: env.swaggerEnabled ? { directives: swaggerCsp() } : undefined,
    }),
  );
  if (env.corsOrigins.length > 0) {
    app.enableCors({ origin: env.corsOrigins, credentials: true });
  }
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'healthz', method: RequestMethod.GET },
      { path: 'readyz', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  if (env.swaggerEnabled) {
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, buildOpenApiDocumentConfig()),
      {
        jsonDocumentUrl: 'docs-json',
      },
    );
  }

  return app;
}
