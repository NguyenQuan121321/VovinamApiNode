import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CreateAttendanceSessionDto {
  @IsUUID()
  classId!: string;

  @IsDateString()
  sessionDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}

export class BulkAttendanceRecordDto {
  @IsUUID()
  studentId!: string;

  @IsEnum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])
  status!: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Bulk upsert payload (plan 8): one entry per student, all-or-nothing. */
export class BulkAttendanceRecordsDto {
  @Type(() => BulkAttendanceRecordDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  records!: BulkAttendanceRecordDto[];
}

export class AttendanceHistoryQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AttendanceSummaryQueryDto {
  @IsUUID()
  studentId!: string;

  /** Month bucket YYYY-MM (plan 8: summary = present/absent counts). */
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}
