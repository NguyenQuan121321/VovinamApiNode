import { Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AuthService } from './auth.service';
import { TokenService } from './domain/token.service';
import { RefreshTokenService } from './domain/refresh-token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { createMailSender } from './mail/mail.factory';
import { MAIL_PORT } from './mail/mail.port';
import { SealService } from './mfa/seal.service';
import { TotpService } from './mfa/totp.service';
import { UsedTokenPurgeJob } from './used-token.purge';
import { EnvService } from '../config/env.service';
import { APP_LOGGER } from '../logging/pino-logger.factory';

@Module({
  controllers: [AuthController, AdminUsersController],
  providers: [
    AuthService,
    AdminUsersService,
    TokenService,
    RefreshTokenService,
    AuditService,
    SealService,
    TotpService,
    UsedTokenPurgeJob,
    JwtAuthGuard,
    RolesGuard,
    {
      provide: MAIL_PORT,
      inject: [EnvService, APP_LOGGER],
      useFactory: createMailSender,
    },
  ],
  exports: [
    TokenService,
    RefreshTokenService,
    AuditService,
    JwtAuthGuard,
    RolesGuard,
    // The notifications outbox delivers EMAIL through the same mail boundary.
    MAIL_PORT,
  ],
})
export class AuthModule {}
