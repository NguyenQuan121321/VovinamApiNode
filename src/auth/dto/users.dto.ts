import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { PageDto } from '../../common/pagination.dto';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  /** Optional display name stored on the linked student profile, not on the account. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}

export class UpdateUserDto {
  /** Changing the role revokes all sessions and bumps pwd_version immediately. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Admin-set replacement password (policy-validated); revokes all sessions. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword?: string;
}

export class ListUsersQueryDto extends PageDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListAuditLogQueryDto extends PageDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  event?: string;
}
