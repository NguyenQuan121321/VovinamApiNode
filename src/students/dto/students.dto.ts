import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStudentDto {
  @IsString()
  @Length(2, 100)
  fullName!: string;

  @IsDateString()
  dob!: string;

  @IsEnum(['MALE', 'FEMALE', 'OTHER'])
  gender!: 'MALE' | 'FEMALE' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  medicalNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  currentBeltRankId?: number;

  /** Links the profile to an existing (verified-email) STUDENT account, e.g. an adult self-registration awaiting approval. */
  @IsOptional()
  @IsEmail()
  linkedUserEmail?: string;
}

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @IsOptional()
  @IsDateString()
  dob?: string;

  @IsOptional()
  @IsEnum(['MALE', 'FEMALE', 'OTHER'])
  gender?: 'MALE' | 'FEMALE' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  medicalNotes?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  currentBeltRankId?: number;

  @IsOptional()
  @IsEnum(['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'])
  status?: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'LEFT';
}

export class ListStudentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsEnum(['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'])
  status?: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'LEFT';

  @IsOptional()
  @IsString()
  @MinLength(2)
  search?: string;
}

export class LinkChildDto {
  /** The 8-character single-use code the club handed to the parent (plan 7.1). */
  @IsString()
  @Length(8, 8)
  inviteCode!: string;
}
