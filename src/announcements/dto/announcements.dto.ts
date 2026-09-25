import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateAnnouncementDto {
  @ApiProperty({ description: 'Announcement title.', example: 'Nghỉ lễ 2/9' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @ApiProperty({
    description: 'Announcement body (Markdown/plain text).',
    example: 'CLB nghỉ các ngày 1-2/9. Các lớp học lại bình thường từ 3/9.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body!: string;

  @ApiProperty({
    description:
      'ALL = whole club (ADMIN only); CLASS = one class only. Instructors may only post CLASS.',
    enum: ['ALL', 'CLASS'],
    example: 'CLASS',
  })
  @IsEnum(['ALL', 'CLASS'])
  audience!: 'ALL' | 'CLASS';

  @ApiPropertyOptional({
    description:
      'Target class for audience=CLASS (required; instructors must teach it); forbidden when audience=ALL.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class UpdateAnnouncementDto {
  @ApiPropertyOptional({ description: 'Announcement title.', example: 'Nghỉ lễ 2/9 (đã cập nhật)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title?: string;

  @ApiPropertyOptional({
    description: 'Announcement body (Markdown/plain text).',
    example: 'Học bù vào thứ 7 này.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body?: string;

  @ApiPropertyOptional({
    description:
      'New audience; switching to ALL clears the class target (instructors cannot switch to ALL).',
    enum: ['ALL', 'CLASS'],
    example: 'CLASS',
  })
  @IsOptional()
  @IsEnum(['ALL', 'CLASS'])
  audience?: 'ALL' | 'CLASS';

  @ApiPropertyOptional({
    description: 'New target class; must be consistent with the effective audience.',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class ListAnnouncementsQueryDto extends PageDto {}
