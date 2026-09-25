import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { PageDto } from '../../common/pagination.dto';

export class CreateAttendanceSessionDto {
  @ApiProperty({
    description: 'Class the session belongs to; you must manage that class.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsUUID()
  classId!: string;

  @ApiProperty({
    description: 'Calendar date of the session; one session per class per date (unique).',
    example: '2026-09-22',
  })
  @IsDateString()
  sessionDate!: string;

  @ApiPropertyOptional({
    description: 'Lesson topic for the session.',
    example: 'Đòn thế số 5-6, phản đòn',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
}

export class BulkAttendanceRecordDto {
  @ApiProperty({
    description: 'StudentProfile id; must be currently enrolled in the session class.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    description: 'Attendance status for the student in this session.',
    enum: ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'],
    example: 'PRESENT',
  })
  @IsEnum(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'])
  status!: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

  @ApiPropertyOptional({
    description: 'Optional note (e.g. late reason).',
    example: 'Came 10 min late',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** Bulk upsert payload (plan 8): one entry per student, all-or-nothing. */
export class BulkAttendanceRecordsDto {
  @ApiProperty({
    description:
      'One entry per student; each student may appear once, all entries must be enrolled in the class, and the whole batch applies atomically.',
    type: BulkAttendanceRecordDto,
    isArray: true,
    maxItems: 200,
  })
  @Type(() => BulkAttendanceRecordDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  records!: BulkAttendanceRecordDto[];
}

/** Paginated like every other list (plan 9): a student's history can span years. */
export class AttendanceHistoryQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Only sessions on/after this date (ISO 8601).',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Only sessions on/before this date (ISO 8601).',
    example: '2026-09-30',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class AttendanceSummaryQueryDto {
  @ApiProperty({
    description: 'StudentProfile id to summarize; ownership guard applies.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    description: 'Month bucket YYYY-MM (plan 8: summary = present/absent counts).',
    example: '2026-09',
  })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

export class AttendanceReportQueryDto {
  @ApiProperty({ description: 'Month bucket YYYY-MM for the report window.', example: '2026-09' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}
