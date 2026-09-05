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
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsIn(['STUDENT', 'PARENT'])
  role!: 'STUDENT' | 'PARENT';

  @IsString()
  @Length(2, 100)
  fullName!: string;

  @IsDateString()
  dateOfBirth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @Length(20, 200)
  refreshToken!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Length(10, 500)
  token!: string;
}

export class EmailOnlyDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(10, 500)
  token!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
