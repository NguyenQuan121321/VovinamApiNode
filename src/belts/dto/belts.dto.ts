import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateBeltRankDto {
  /** Club code, e.g. LAM_1, VANG_2, DO_6 (plan section 6). */
  @IsString()
  @Length(2, 30)
  code!: string;

  @IsString()
  @Length(2, 100)
  name!: string;

  @IsEnum(['LAM', 'VANG', 'DO', 'HUYEN'])
  rankGroup!: 'LAM' | 'VANG' | 'DO' | 'HUYEN';

  /** Global ordering across all groups; promotion always targets a higher order. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  orderIndex!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBeltRankDto {
  @IsOptional()
  @IsString()
  @Length(2, 30)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsEnum(['LAM', 'VANG', 'DO', 'HUYEN'])
  rankGroup?: 'LAM' | 'VANG' | 'DO' | 'HUYEN';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  orderIndex?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
