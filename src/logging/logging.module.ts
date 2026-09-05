import { Global, Module } from '@nestjs/common';
import type { Logger } from 'pino';
import { EnvService } from '../config/env.service';
import { APP_LOGGER, createAppLogger } from './pino-logger.factory';
import { PinoLoggerService } from './pino-logger.service';

/** Global so every feature module can inject the pino logger through APP_LOGGER. */
@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      inject: [EnvService],
      useFactory: (env: EnvService): Logger => createAppLogger(env),
    },
    {
      provide: PinoLoggerService,
      inject: [APP_LOGGER],
      useFactory: (logger: Logger): PinoLoggerService => new PinoLoggerService(logger),
    },
  ],
  exports: [APP_LOGGER, PinoLoggerService],
})
export class LoggingModule {}
