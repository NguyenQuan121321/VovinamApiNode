import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PageDto } from '../../common/pagination.dto';

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body!: string;

  @IsEnum(['ALL', 'CLASS'])
  audience!: 'ALL' | 'CLASS';

  /** Required when audience=CLASS, forbidden when audience=ALL (service rule). */
  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  body?: string;

  @IsOptional()
  @IsEnum(['ALL', 'CLASS'])
  audience?: 'ALL' | 'CLASS';

  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class ListAnnouncementsQueryDto extends PageDto {}
