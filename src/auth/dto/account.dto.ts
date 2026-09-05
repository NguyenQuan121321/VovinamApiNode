import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;

  /** Required when TOTP is enabled on the account (plan 4.2: inline confirmation). */
  @IsOptional()
  @IsString()
  @Length(6, 12)
  code?: string;
}

export class ChangeEmailRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @IsString()
  @Length(5, 200)
  newEmail!: string;
}

export class ChangeEmailConfirmDto {
  @IsString()
  @Length(10, 500)
  token!: string;
}

export class SensitiveOperationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;

  /** Required when TOTP is enabled on the account (plan 4.2: inline confirmation). */
  @IsOptional()
  @IsString()
  @Length(6, 12)
  code?: string;
}
