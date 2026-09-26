import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreatePromotionProposalDto {
  @ApiProperty({
    description:
      'StudentProfile to propose; ownership guard applies (instructors: own-class students only).',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    description:
      'BeltRank id proposed; must be an active rank strictly above the student current rank. Advisory only — approval never moves the belt.',
    example: 5,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  proposedRankId!: number;

  @ApiPropertyOptional({
    description: 'Motivation shown to the master when reviewing.',
    example: 'Consistent training, ready for the exam',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ReviewProposalDto {
  @ApiProperty({
    description: 'Master decision; only PENDING proposals can be reviewed.',
    enum: ['APPROVED', 'REJECTED'],
    example: 'APPROVED',
  })
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({ description: 'Decision note.', example: 'Approved — schedule the exam' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateProposalDto {
  @ApiPropertyOptional({
    description: 'Replacement note; only the author (or an admin) may edit while PENDING.',
    example: 'Also passed the grading test',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListProposalsQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by workflow status.',
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    example: 'PENDING',
  })
  @IsOptional()
  @IsString()
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Filter by student.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
