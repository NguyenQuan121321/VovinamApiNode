import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreatePromotionProposalDto {
  @IsUUID()
  studentId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  proposedRankId!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReviewProposalDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateProposalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListProposalsQueryDto extends PageDto {
  @IsOptional()
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
