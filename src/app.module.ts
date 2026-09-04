import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import type { Logger } from 'pino';
import { AppConfigModule } from './config/app-config.module';
import { EnvService } from './config/env.service';
import { validateEnv } from './config/env.validation';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor';
import { ResponseInterceptor } from './common/response.interceptor';
import { InMemorySharedStore, SHARED_STORE } from './common/shared-store';
import { HealthModule } from './health/health.module';
import { MetricsMiddleware } from './health/metrics.middleware';
import { APP_LOGGER, createAppLogger } from './logging/pino-logger.factory';
import { PinoLoggerService } from './logging/pino-logger.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { ClassesModule } from './classes/classes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    AppConfigModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    BillingModule,
    ClassesModule,
  ],
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
    { provide: SHARED_STORE, useClass: InMemorySharedStore },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
