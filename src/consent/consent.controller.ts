import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/guards/current-user.decorator';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { ConsentService } from './consent.service';
import { GrantConsentDto, RevokeConsentDto } from './dto/consent.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  /** Grant (or idempotently re-affirm) one purpose; parent-for-minor via studentId. */
  @Post('consent')
  grant(@CurrentUser() user: AuthenticatedUser, @Body() dto: GrantConsentDto) {
    return this.consent.grant(user, dto);
  }

  /** Revoke the active row of one purpose; history stays intact. */
  @Post('consent/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthenticatedUser, @Body() dto: RevokeConsentDto) {
    return this.consent.revoke(user, dto);
  }

  /** Own consent history, revocations included. */
  @Get('consent/me')
  @HttpCode(200)
  history(@CurrentUser() user: AuthenticatedUser) {
    return this.consent.myHistory(user);
  }
}
