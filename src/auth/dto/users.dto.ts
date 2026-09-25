import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({ description: 'New account email (unique).', example: 'hong.sv@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'Initial password (policy-validated). The admin hands it to the user out of band.',
    example: 'VoSinh2026!a',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({
    description:
      'Role of the new account; creating INSTRUCTOR/ADMIN accounts is the supported staff path.',
    enum: Object.values(UserRole),
    example: 'INSTRUCTOR',
  })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({
    description: 'Optional display name stored on the linked student profile, not on the account.',
    example: 'Nguyễn Thị Hồng',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional({
    description:
      'New role. Changing it revokes all sessions and bumps the password version immediately.',
    enum: Object.values(UserRole),
    example: 'INSTRUCTOR',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Deactivating (false) revokes all sessions; reactivation does not restore them.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Admin-set replacement password (policy-validated); revokes all sessions.',
    example: 'VoSinh2026!b',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword?: string;
}

export class ListUsersQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by role.',
    enum: Object.values(UserRole),
    example: 'STUDENT',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the email.',
    example: '@example.com',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class ListAuditLogQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by acting user id (UUID).',
    example: '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter by audit event name, e.g. login, user_updated, invoice_created.',
    example: 'login',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  event?: string;
}
