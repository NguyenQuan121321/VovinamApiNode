import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiPropertyOptional({
    description:
      'Human-readable exam code (e.g. EXAM-2026-03); generated as EXAM-<year>-NN when omitted.',
    example: 'EXAM-2026-03',
  })
  @IsOptional()
  @IsString()
  @Length(4, 30)
  code?: string;

  @ApiProperty({ description: 'Exam title.', example: 'Kỳ thi thăng đai vàng — tháng 3' })
  @IsString()
  @Length(2, 150)
  title!: string;

  @ApiProperty({ description: 'Exam date (ISO 8601).', example: '2026-03-28' })
  @IsDateString()
  examDate!: string;

  @ApiPropertyOptional({ description: 'Exam venue.', example: 'Nhà thi đấu Q.1' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiProperty({
    description: 'BeltRank id the exam promotes to (must be an active rank).',
    example: 4,
  })
  @Type(() => Number)
  @IsInt()
  targetRankId!: number;

  @ApiProperty({ description: 'Exam fee in VND (integer).', example: 150000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  feeAmount!: number;

  @ApiPropertyOptional({
    description: 'Maximum number of active registrations; omit for unbounded.',
    example: 40,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @ApiProperty({
    description:
      'Registration deadline (ISO 8601); must not be after the exam date. Later registrations are rejected.',
    example: '2026-03-20',
  })
  @IsDateString()
  registrationDeadline!: string;
}

export class UpdateBeltExamDto {
  @ApiPropertyOptional({ description: 'Exam code.', example: 'EXAM-2026-03' })
  @IsOptional()
  @IsString()
  @Length(4, 30)
  code?: string;

  @ApiPropertyOptional({ description: 'Exam title.', example: 'Kỳ thi thăng đai vàng — tháng 3' })
  @IsOptional()
  @IsString()
  @Length(2, 150)
  title?: string;

  @ApiPropertyOptional({ description: 'Exam date (ISO 8601).', example: '2026-03-28' })
  @IsOptional()
  @IsDateString()
  examDate?: string;

  @ApiPropertyOptional({ description: 'Exam venue.', example: 'Nhà thi đấu Q.1' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({
    description: 'BeltRank id the exam promotes to (must be an active rank).',
    example: 4,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  targetRankId?: number;

  @ApiPropertyOptional({ description: 'Exam fee in VND (integer).', example: 150000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  feeAmount?: number;

  @ApiPropertyOptional({ description: 'Maximum number of active registrations.', example: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @ApiPropertyOptional({
    description: 'Registration deadline (ISO 8601); must not be after the exam date.',
    example: '2026-03-20',
  })
  @IsOptional()
  @IsDateString()
  registrationDeadline?: string;

  @ApiPropertyOptional({
    description:
      'Lifecycle: DRAFT → OPEN → CLOSED → COMPLETED, or CANCELLED. Registration requires OPEN.',
    enum: ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'],
    example: 'OPEN',
  })
  @IsOptional()
  @IsEnum(['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'])
  status?: 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';
}

export class ListExamsQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by lifecycle status.',
    enum: ['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'],
    example: 'OPEN',
  })
  @IsOptional()
  @IsEnum(['DRAFT', 'OPEN', 'CLOSED', 'COMPLETED', 'CANCELLED'])
  status?: 'DRAFT' | 'OPEN' | 'CLOSED' | 'COMPLETED' | 'CANCELLED';
}

export class RegisterExamDto {
  @ApiProperty({
    description:
      'The student to register; must pass the ownership guard (self for STUDENT, verified link for PARENT).',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;
}

export class ExamResultDto {
  @ApiProperty({
    description:
      'RESULT_PASS promotes the student to the exam target rank; RESULT_FAIL leaves the belt unchanged.',
    enum: ['RESULT_PASS', 'RESULT_FAIL'],
    example: 'RESULT_PASS',
  })
  @IsEnum(['RESULT_PASS', 'RESULT_FAIL'])
  status!: 'RESULT_PASS' | 'RESULT_FAIL';

  @ApiPropertyOptional({
    description: 'Examiner note recorded with the result.',
    example: 'Good spirit; polish đòn thế 5',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resultNote?: string;

  @ApiPropertyOptional({
    description:
      'ADMIN only: attribute the result to another examiner (user id). Defaults to the caller.',
    example: '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  })
  @IsOptional()
  @IsUUID()
  examinerId?: string;
}

/** Belt history (matrix row 17): registrations of one student, guard 7.3 scoped. */
export class ListExamRegistrationsQueryDto extends PageDto {
  @ApiProperty({
    description: 'StudentProfile whose exam history to list; ownership guard applies.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;
}
