import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ description: 'Current password (re-authentication).', example: 'VoSinh2026!x' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    description: 'Replacement password (policy-validated). Revokes all other sessions.',
    example: 'VoSinh2026!z',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;

  @ApiPropertyOptional({
    description: 'Current TOTP code; required when MFA is enabled on the account.',
    example: '123456',
  })
  @IsOptional()
  @IsString()
  @Length(6, 12)
  code?: string;
}

export class ChangeEmailRequestDto {
  @ApiProperty({ description: 'Current password (re-authentication).', example: 'VoSinh2026!x' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({
    description:
      'New email address. The change only applies after the emailed confirmation token is used.',
    example: 'thao.vovan+new@example.com',
  })
  @IsEmail()
  @Length(5, 200)
  newEmail!: string;
}

export class ChangeEmailConfirmDto {
  @ApiProperty({
    description: 'Email-change confirmation token from the email sent to the NEW address.',
    example: '55ac...77',
  })
  @IsString()
  @Length(10, 500)
  token!: string;
}

export class SensitiveOperationDto {
  @ApiProperty({
    description: 'Current password (re-authentication for a sensitive operation).',
    example: 'VoSinh2026!x',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional({
    description: 'Current TOTP code; required when MFA is enabled on the account.',
    example: '123456',
  })
  @IsOptional()
  @IsString()
  @Length(6, 12)
  code?: string;
}
