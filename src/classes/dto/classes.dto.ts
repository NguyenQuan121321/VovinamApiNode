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
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PageDto } from '../../common/pagination.dto';
import { HH_MM_PATTERN } from '../time';

export class CreateClassDto {
  @ApiProperty({ description: 'Class name.', example: 'Cơ bản A1 — Thứ 3/5' })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({
    description:
      'User id of the assigned instructor; must be an active user with the INSTRUCTOR role.',
    example: '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  })
  @IsUUID()
  instructorId!: string;

  @ApiPropertyOptional({ description: 'Where the class trains.', example: 'Sân A — CLB Q.1' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({
    description: 'Maximum number of simultaneously active enrollments (1..500).',
    example: 30,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;
}

export class UpdateClassDto {
  @ApiPropertyOptional({ description: 'Class name.', example: 'Cơ bản A1 — Thứ 3/5' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({
    description: 'User id of the new instructor (must have the INSTRUCTOR role).',
    example: '5f0c9d3a-1b2c-4d5e-8f90-1a2b3c4d5e6f',
  })
  @IsOptional()
  @IsUUID()
  instructorId?: string;

  @ApiPropertyOptional({ description: 'Where the class trains.', example: 'Sân A — CLB Q.1' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional({
    description: 'New capacity; cannot be lower than the current number of active enrollments.',
    example: 35,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  @ApiPropertyOptional({
    description:
      'Lifecycle status. PAUSED/ARCHIVED block new sessions and enrollments; history stays readable.',
    enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

export class CreateScheduleDto {
  @ApiProperty({
    description: 'Day of week, 0 = Sunday .. 6 = Saturday (Postgres DOW convention).',
    example: 2,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({ description: 'Start time HH:MM (24h).', example: '18:00' })
  @Matches(HH_MM_PATTERN)
  startTime!: string;

  @ApiProperty({
    description: 'End time HH:MM (24h); must be after the start time.',
    example: '19:30',
  })
  @Matches(HH_MM_PATTERN)
  endTime!: string;

  @ApiProperty({
    description: 'First date the slot applies (ISO 8601 date).',
    example: '2026-09-01',
  })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional({
    description: 'Last date the slot applies; omit for an open-ended slot.',
    example: '2026-12-31',
  })
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class ListClassesQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by lifecycle status.',
    enum: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsEnum(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}
