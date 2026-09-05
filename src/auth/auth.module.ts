import { Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './domain/token.service';
import { RefreshTokenService } from './domain/refresh-token.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { LoggingMailSender } from './mail/logging-mail.sender';
import { MAIL_PORT } from './mail/mail.port';
import { UsedTokenPurgeJob } from './used-token.purge';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshTokenService,
    AuditService,
    UsedTokenPurgeJob,
    JwtAuthGuard,
    RolesGuard,
    { provide: MAIL_PORT, useClass: LoggingMailSender },
  ],
  exports: [TokenService, RefreshTokenService, AuditService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
