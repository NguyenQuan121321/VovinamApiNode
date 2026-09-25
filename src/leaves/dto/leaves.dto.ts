import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateLeaveRequestDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  classId!: string;

  /** The class session the student will miss (YYYY-MM-DD). */
  @IsDateString()
  sessionDate!: string;

  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ReviewLeaveRequestDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListLeaveRequestsQueryDto extends PageDto {
  @IsOptional()
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
