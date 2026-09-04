import 'reflect-metadata';
import type { Logger } from 'pino';
import { createApp } from './bootstrap';
import { EnvService } from './config/env.service';
import { APP_LOGGER } from './logging/pino-logger.factory';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const env = app.get(EnvService);
  await app.listen(env.port, '0.0.0.0');
  app.get<Logger>(APP_LOGGER).info({ port: env.port, env: env.nodeEnv }, 'server_started');
}

void bootstrap();
