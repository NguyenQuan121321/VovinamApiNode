import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateBeltExamDto {
  /** Human-readable exam code (e.g. EXAM-2026-03); generated when omitted. */
  @IsOptional()
  @IsString()
  @Length(4, 30)
  code?: string;

  @IsString()
  @Length(2, 150)
  title!: string;

  @IsDateString()
  examDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  /** Belt rank the exam promotes to. */
  @Type(() => Number)
  @IsInt()
  targetRankId!: number;

  /** VND integer. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  feeAmount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @IsDateString()
  registrationDeadline!: string;
}

export class UpdateBeltExamDto {
  @IsOptional()
  @IsString()
  @Length(4, 30)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 150)
  title?: string;

  @IsOptional()
  @IsDateString()
  examDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  targetRankId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  feeAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @IsOptional()
  @IsDateString()
  registrationDeadline?: string;

  @IsOptional()
  @IsEnum(['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'])
  status?: 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';
}

export class ListExamsQueryDto extends PageDto {
  @IsOptional()
  @IsEnum(['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'])
  status?: 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';
}

export class RegisterExamDto {
  /** The student to register; validated through the ownership guard (plan 7.3). */
  @IsUUID()
  studentId!: string;
}

export class ExamResultDto {
  @IsEnum(['RESULT_PASS', 'RESULT_FAIL'])
  status!: 'RESULT_PASS' | 'RESULT_FAIL';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resultNote?: string;

  /** ADMIN may attribute the result to another examiner; defaults to the caller. */
  @IsOptional()
  @IsUUID()
  examinerId?: string;
}
