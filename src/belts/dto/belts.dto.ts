import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateBeltRankDto {
  @ApiProperty({ description: 'Club code, e.g. LAM_1, VANG_2, DO_6 (unique).', example: 'VANG_3' })
  @IsString()
  @Length(2, 30)
  code!: string;

  @ApiProperty({ description: 'Display name.', example: 'Vai đai vàng đệ tam' })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({
    description: 'Rank group.',
    enum: ['LAM', 'VANG', 'DO', 'HUYEN'],
    example: 'VANG',
  })
  @IsEnum(['LAM', 'VANG', 'DO', 'HUYEN'])
  rankGroup!: 'LAM' | 'VANG' | 'DO' | 'HUYEN';

  @ApiProperty({
    description: 'Global ordering across all groups; promotion always targets a higher order.',
    example: 6,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  orderIndex!: number;

  @ApiPropertyOptional({
    description: 'Deactivated ranks cannot be targets of exams or proposals.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBeltRankDto {
  @ApiPropertyOptional({ description: 'Club code (unique).', example: 'VANG_3' })
  @IsOptional()
  @IsString()
  @Length(2, 30)
  code?: string;

  @ApiPropertyOptional({ description: 'Display name.', example: 'Vai đai vàng đệ tam' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiPropertyOptional({
    description: 'Rank group.',
    enum: ['LAM', 'VANG', 'DO', 'HUYEN'],
    example: 'VANG',
  })
  @IsOptional()
  @IsEnum(['LAM', 'VANG', 'DO', 'HUYEN'])
  rankGroup?: 'LAM' | 'VANG' | 'DO' | 'HUYEN';

  @ApiPropertyOptional({ description: 'Global ordering across all groups (unique).', example: 6 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  orderIndex?: number;

  @ApiPropertyOptional({
    description: 'Deactivated ranks cannot be targets of exams or proposals.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
