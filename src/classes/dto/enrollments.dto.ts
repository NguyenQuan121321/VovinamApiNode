import { IsOptional, IsUUID } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateEnrollmentDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  classId!: string;
}

export class ListEnrollmentsQueryDto extends PageDto {
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
