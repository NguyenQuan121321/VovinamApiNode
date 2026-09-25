import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class TotpCodeDto {
  @ApiProperty({
    description:
      '6-digit TOTP code from the authenticator app (or an 8-character recovery code where accepted).',
    example: '492031',
  })
  @IsString()
  @Length(6, 12)
  code!: string;
}

export class TotpDisableDto {
  @ApiProperty({ description: 'Current TOTP code from the authenticator app.', example: '492031' })
  @IsString()
  @Length(6, 12)
  code!: string;

  @ApiProperty({ description: 'Account password (re-authentication).', example: 'VoSinh2026!x' })
  @IsString()
  @Length(1, 128)
  password!: string;
}

export class MfaLoginVerifyDto {
  @ApiProperty({
    description: 'Short-lived mfaToken returned by POST /auth/login when mfaRequired is true.',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString()
  @Length(10, 1000)
  mfaToken!: string;

  @ApiProperty({
    description: '6-digit TOTP code or 8-character recovery code.',
    example: '492031',
  })
  @IsString()
  @Length(6, 12)
  code!: string;
}
