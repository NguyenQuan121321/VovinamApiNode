import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppConfigModule } from './config/app-config.module';
import { validateEnv } from './config/env.validation';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor';
import { ResponseInterceptor } from './common/response.interceptor';
import { SharedStoreModule } from './common/shared-store.module';
import { HealthModule } from './health/health.module';
import { MetricsMiddleware } from './health/metrics.middleware';
import { LoggingModule } from './logging/logging.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { ClassesModule } from './classes/classes.module';
import { StudentsModule } from './students/students.module';
import { ParentsModule } from './parents/parents.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    AppConfigModule,
    LoggingModule,
    SharedStoreModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    BillingModule,
    ClassesModule,
    StudentsModule,
    ParentsModule,
  ],
  providers: [
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
