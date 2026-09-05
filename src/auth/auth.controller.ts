import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './guards/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { AuthenticatedRequest } from './guards/authenticated-request';
import {
  EmailOnlyDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import {
  ChangeEmailConfirmDto,
  ChangeEmailRequestDto,
  ChangePasswordDto,
  SensitiveOperationDto,
} from './dto/account.dto';
import { MfaLoginVerifyDto, TotpCodeDto, TotpDisableDto } from './dto/mfa.dto';
import { PageDto } from '../common/pagination.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, req.ip);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, req.ip, req.headers['user-agent']);
  }

  @Post('refresh-token')
  @HttpCode(200)
  refreshToken(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, req.ip);
  }

  @Post('verify-email')
  verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request) {
    return this.auth.verifyEmail(dto, req.ip);
  }

  @Post('resend-verification')
  @HttpCode(200)
  resendVerification(@Body() dto: EmailOnlyDto, @Req() req: Request) {
    return this.auth.resendVerification(dto, req.ip);
  }

  @Post('forgot-password')
  @HttpCode(200)
  forgotPassword(@Body() dto: EmailOnlyDto, @Req() req: Request) {
    return this.auth.forgotPassword(dto, req.ip);
  }

  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.auth.resetPassword(dto, req.ip);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  logout(@Req() req: AuthenticatedRequest & Request) {
    const user = req.user;
    if (user === undefined) {
      throw new Error('unreachable: guard guarantees user');
    }
    return this.auth.logout(
      (req.headers.authorization ?? '').slice('Bearer '.length),
      user.jti,
      user.sessionId,
      req.ip,
    );
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  logoutAll(@CurrentUser() user: { id: string; jti: string }, @Req() req: Request) {
    return this.auth.logoutAll(user.id, user.jti, req.ip);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  sessions(@CurrentUser() user: { id: string }) {
    return this.auth.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @UseGuards(JwtAuthGuard)
  async revokeSession(
    @CurrentUser() user: { id: string },
    @Param('id') sessionId: string,
    @Req() req: Request,
  ): Promise<{ revoked: boolean }> {
    await this.auth.revokeSession(user.id, sessionId, req.ip);
    return { revoked: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: { id: string }) {
    return this.auth.me(user.id);
  }

  @Get('me/audit-log')
  @UseGuards(JwtAuthGuard)
  auditLog(@CurrentUser() user: { id: string }, @Query() query: PageDto) {
    return this.auth.auditLog(user.id, query.page, query.limit);
  }

  // ── Account lifecycle ───────────────────────────────────────────────────────

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser() user: { id: string; jti: string },
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ) {
    return this.auth.changePassword(user.id, dto, user.jti, req.ip);
  }

  @Post('change-email/request')
  @UseGuards(JwtAuthGuard)
  requestChangeEmail(
    @CurrentUser() user: { id: string },
    @Body() dto: ChangeEmailRequestDto,
    @Req() req: Request,
  ) {
    return this.auth.requestChangeEmail(user.id, dto, req.ip);
  }

  @Post('change-email/confirm')
  confirmChangeEmail(@Body() dto: ChangeEmailConfirmDto, @Req() req: Request) {
    return this.auth.confirmChangeEmail(dto.token, req.ip);
  }

  @Post('deactivate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  deactivate(
    @CurrentUser() user: { id: string; jti: string },
    @Body() dto: SensitiveOperationDto,
    @Req() req: Request,
  ) {
    return this.auth.deactivate(user.id, dto, user.jti, req.ip);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  deactivateViaDelete(
    @CurrentUser() user: { id: string; jti: string },
    @Body() dto: SensitiveOperationDto,
    @Req() req: Request,
  ) {
    return this.auth.deactivate(user.id, dto, user.jti, req.ip);
  }

  // ── MFA ─────────────────────────────────────────────────────────────────────

  @Post('mfa/login-verify')
  @HttpCode(200)
  mfaLoginVerify(@Body() dto: MfaLoginVerifyDto, @Req() req: Request) {
    return this.auth.mfaLoginVerify(dto, req.ip, req.headers['user-agent']);
  }

  @Get('mfa/methods')
  @UseGuards(JwtAuthGuard)
  mfaMethods(@CurrentUser() user: { id: string }) {
    return this.auth.mfaMethods(user.id);
  }

  @Post('mfa/totp/enable')
  @UseGuards(JwtAuthGuard)
  totpEnable(@CurrentUser() user: { id: string }) {
    return this.auth.totpEnable(user.id);
  }

  @Post('mfa/totp/verify')
  @UseGuards(JwtAuthGuard)
  totpVerify(@CurrentUser() user: { id: string }, @Body() dto: TotpCodeDto, @Req() req: Request) {
    return this.auth.totpVerify(user.id, dto.code, req.ip);
  }

  @Post('mfa/totp/validate')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  totpValidate(@CurrentUser() user: { id: string }, @Body() dto: TotpCodeDto) {
    return this.auth.totpValidate(user.id, dto.code);
  }

  @Post('mfa/totp/disable')
  @UseGuards(JwtAuthGuard)
  totpDisable(
    @CurrentUser() user: { id: string },
    @Body() dto: TotpDisableDto,
    @Req() req: Request,
  ) {
    return this.auth.totpDisable(user.id, dto, req.ip);
  }

  @Get('mfa/totp/recovery-codes')
  @UseGuards(JwtAuthGuard)
  recoveryCodes(@CurrentUser() user: { id: string }) {
    return this.auth.recoveryCodesRemaining(user.id);
  }
}
