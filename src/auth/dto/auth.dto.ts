import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({
    description: 'Account email; doubles as the login name and verification target.',
    example: 'thao.vovan@example.com',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description:
      'Account password. Policy: at least 8 characters with letters and digits, and it must not contain the email.',
    example: 'VoSinh2026!x',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({
    description:
      'Self-service roles only. Staff roles (INSTRUCTOR, ADMIN) are created by an admin through the backoffice.',
    enum: ['STUDENT', 'PARENT'],
    example: 'STUDENT',
  })
  @IsIn(['STUDENT', 'PARENT'])
  role!: 'STUDENT' | 'PARENT';

  @ApiProperty({
    description: 'Full display name of the account holder.',
    example: 'Võ Văn Thảo',
  })
  @IsString()
  @Length(2, 100)
  fullName!: string;

  @ApiProperty({
    description:
      'Date of birth (ISO 8601 date). Minors are registered by the club, never self-serve.',
    example: '2008-05-14',
  })
  @IsDateString()
  dateOfBirth!: string;

  @ApiPropertyOptional({ description: 'Contact phone number.', example: '+84901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ description: 'Account email.', example: 'thao.vovan@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Account password (plaintext over TLS).', example: 'VoSinh2026!x' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'The refresh token returned by login / mfa login-verify / refresh-token. Rotated on every use.',
    example: 'b3JkZXItc2VjcmV0LXJlZnJlc2gtdG9rZW4tdmFsdWU',
  })
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Email verification token from the verification link (valid 24 hours).',
    example: '8f1c...a9',
  })
  @IsString()
  @Length(10, 500)
  token!: string;
}

export class EmailOnlyDto {
  @ApiProperty({
    description: 'Account email the mail should be sent to.',
    example: 'thao.vovan@example.com',
  })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Password reset token from the email link (valid 15 minutes).',
    example: '3b7e...c1',
  })
  @IsString()
  @Length(10, 500)
  token!: string;

  @ApiProperty({
    description: 'New password. Policy: at least 8 characters with letters and digits.',
    example: 'VoSinh2026!y',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
