import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateStudentDto {
  @ApiProperty({ description: 'Full name of the student.', example: 'Võ Văn Thảo' })
  @IsString()
  @Length(2, 100)
  fullName!: string;

  @ApiProperty({ description: 'Date of birth (ISO 8601 date).', example: '2008-05-14' })
  @IsDateString()
  dob!: string;

  @ApiProperty({
    description: 'Recorded gender.',
    enum: ['MALE', 'FEMALE', 'OTHER'],
    example: 'MALE',
  })
  @IsEnum(['MALE', 'FEMALE', 'OTHER'])
  gender!: 'MALE' | 'FEMALE' | 'OTHER';

  @ApiPropertyOptional({ description: 'Contact phone number.', example: '+84901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Home address.', example: '12 Nguyễn Trãi, Q.1, TP.HCM' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({
    description: 'Emergency contact person (typically a parent).',
    example: 'Võ Văn Bảo',
  })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  emergencyContactName?: string;

  @ApiPropertyOptional({ description: 'Emergency contact phone.', example: '+84909876543' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @ApiPropertyOptional({
    description:
      'Medical notes the instructors must know (injuries, asthma, ...). Shown to instructors for safety.',
    example: 'Mild asthma; inhaler in gym bag',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  medicalNotes?: string;

  @ApiPropertyOptional({
    description: 'BeltRank id the student currently holds; omit for an unranked beginner.',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  currentBeltRankId?: number;

  @ApiPropertyOptional({
    description:
      'Links the profile to an existing verified STUDENT account (e.g. an adult self-registration awaiting approval). The account must have no profile yet.',
    example: 'thao.vovan@example.com',
  })
  @IsOptional()
  @IsEmail()
  linkedUserEmail?: string;
}

export class UpdateStudentDto {
  @ApiPropertyOptional({ description: 'Full name of the student.', example: 'Võ Văn Thảo' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @ApiPropertyOptional({ description: 'Date of birth (ISO 8601 date).', example: '2008-05-14' })
  @IsOptional()
  @IsDateString()
  dob?: string;

  @ApiPropertyOptional({
    description: 'Recorded gender.',
    enum: ['MALE', 'FEMALE', 'OTHER'],
    example: 'MALE',
  })
  @IsOptional()
  @IsEnum(['MALE', 'FEMALE', 'OTHER'])
  gender?: 'MALE' | 'FEMALE' | 'OTHER';

  @ApiPropertyOptional({ description: 'Contact phone number.', example: '+84901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Home address.', example: '12 Nguyễn Trãi, Q.1, TP.HCM' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ description: 'Emergency contact person.', example: 'Võ Văn Bảo' })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  emergencyContactName?: string;

  @ApiPropertyOptional({ description: 'Emergency contact phone.', example: '+84909876543' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @ApiPropertyOptional({
    description: 'Medical notes the instructors must know (injuries, asthma, ...).',
    example: 'Mild asthma; inhaler in gym bag',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  medicalNotes?: string;

  @ApiPropertyOptional({ description: 'BeltRank id the student currently holds.', example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  currentBeltRankId?: number;

  @ApiPropertyOptional({
    description:
      'Lifecycle status. PENDING = awaiting club approval, ACTIVE = training, PAUSED = temporarily away, LEFT = departed.',
    enum: ['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'],
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsEnum(['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'])
  status?: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'LEFT';
}

export class ListStudentsQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by lifecycle status.',
    enum: ['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'],
    example: 'ACTIVE',
  })
  @IsOptional()
  @IsEnum(['PENDING', 'ACTIVE', 'PAUSED', 'LEFT'])
  status?: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'LEFT';

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on the full name.',
    example: 'Thảo',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  search?: string;

  @ApiPropertyOptional({
    description: 'Limit to students currently enrolled in one class (role-scoped in the service).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class LinkChildDto {
  @ApiProperty({
    description: 'The 8-character single-use invite code the club handed to the parent.',
    example: 'K7M2PQ4X',
  })
  @IsString()
  @Length(8, 8)
  inviteCode!: string;
}

/** Self-service contact edit (matrix row 4, E*): identity fields stay admin-managed. */
export class UpdateOwnStudentDto {
  @ApiPropertyOptional({ description: 'Contact phone number.', example: '+84901234567' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Home address.', example: '12 Nguyễn Trãi, Q.1, TP.HCM' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ description: 'Emergency contact person.', example: 'Võ Văn Bảo' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @ApiPropertyOptional({ description: 'Emergency contact phone.', example: '+84909876543' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @ApiPropertyOptional({
    description: 'Medical notes visible to instructors for safety.',
    example: 'Recovering ankle sprain',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  medicalNotes?: string;
}
