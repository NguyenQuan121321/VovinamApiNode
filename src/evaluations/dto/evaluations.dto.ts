import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateEvaluationDto {
  @IsUUID()
  studentId!: string;

  /** Optional class context of the evaluation. */
  @IsOptional()
  @IsUUID()
  classId?: string;

  /** Optional period bucket; both month and year must be given together. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  periodYear?: number;

  /** 1..10; the meaning of the scale is the club's. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class UpdateEvaluationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class ListEvaluationsQueryDto extends PageDto {
  @IsUUID()
  studentId!: string;
}
