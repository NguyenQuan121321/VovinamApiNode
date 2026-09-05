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
  @IsString()
  @Length(2, 100)
  name!: string;

  /** Must be an existing user with the INSTRUCTOR role. */
  @IsUUID()
  instructorId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;
}

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsUUID()
  instructorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  capacity?: number;

  /** Archiving keeps enrollment and attendance history readable (plan 7.2 spirit). */
  @IsOptional()
  @IsEnum(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}

export class CreateScheduleDto {
  /** 0 = Sunday .. 6 = Saturday (Postgres DOW convention). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @Matches(HH_MM_PATTERN)
  startTime!: string;

  @Matches(HH_MM_PATTERN)
  endTime!: string;

  @IsDateString()
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;
}

export class ListClassesQueryDto extends PageDto {
  @IsOptional()
  @IsEnum(['ACTIVE', 'PAUSED', 'ARCHIVED'])
  status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
}
