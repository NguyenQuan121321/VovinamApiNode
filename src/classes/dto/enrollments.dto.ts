import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateEnrollmentDto {
  @ApiProperty({
    description: 'StudentProfile id to enroll (must be an ACTIVE profile).',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    description: 'Class id to enroll into (must be an ACTIVE class with free capacity).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsUUID()
  classId!: string;
}

export class ListEnrollmentsQueryDto extends PageDto {
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
