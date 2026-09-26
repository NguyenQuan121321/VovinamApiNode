import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    description:
      'StudentProfile who will miss the session; ownership guard applies (self/linked child).',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    description: 'Class whose session will be missed; the student must be actively enrolled.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsUUID()
  classId!: string;

  @ApiProperty({
    description:
      'Date of the class session the student will miss (ISO date); must be today or later, and one request per (student, class, date).',
    example: '2026-09-29',
  })
  @IsDateString()
  sessionDate!: string;

  @ApiProperty({ description: 'Reason for the absence.', example: 'School event in the evening' })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ReviewLeaveRequestDto {
  @ApiProperty({
    description: 'Review outcome; only PENDING requests can be reviewed.',
    enum: ['APPROVED', 'REJECTED'],
    example: 'APPROVED',
  })
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @ApiPropertyOptional({
    description: 'Reviewer note recorded with the decision.',
    example: 'Approved — have fun at the event',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListLeaveRequestsQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by workflow status.',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
    example: 'PENDING',
  })
  @IsOptional()
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

  @ApiPropertyOptional({
    description: 'Filter by class.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;

  @ApiPropertyOptional({
    description: 'Filter by student.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
