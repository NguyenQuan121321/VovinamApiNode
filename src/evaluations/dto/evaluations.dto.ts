import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateEvaluationDto {
  @ApiProperty({
    description: 'StudentProfile being evaluated; ownership guard applies.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;

  @ApiPropertyOptional({
    description: 'Optional class context of the evaluation.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({
    description: 'Period bucket month (1..12); both month and year must be given together.',
    example: 9,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;

  @ApiPropertyOptional({
    description: 'Period bucket year (2000..2100); both month and year must be given together.',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  periodYear?: number;

  @ApiProperty({ description: 'Rating on the club 1..10 scale.', example: 8 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rating!: number;

  @ApiPropertyOptional({
    description: 'Free-text comment shown to the student and their parents.',
    example: 'Strong progress on đòn thế; keep the guard up',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateEvaluationDto {
  @ApiPropertyOptional({ description: 'New rating (1..10).', example: 9 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rating?: number;

  @ApiPropertyOptional({ description: 'New comment.', example: 'Guard improved after drills' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ListEvaluationsQueryDto extends PageDto {
  @ApiProperty({
    description: 'StudentProfile whose evaluations to list; ownership guard applies.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;
}
