import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class GrantConsentDto {
  @ApiProperty({
    description: 'Consent purpose being granted.',
    enum: ['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'],
    example: 'MEDIA_USAGE',
  })
  @IsEnum(['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'])
  purpose!: 'DATA_PROCESSING' | 'MEDIA_USAGE' | 'MARKETING_NOTICE';

  @ApiPropertyOptional({
    description:
      'A verified PARENT grants on behalf of a linked MINOR (with an account). Omitted when the account holder consents for themselves. Idempotent when an active grant already exists.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class RevokeConsentDto {
  @ApiProperty({
    description: 'Consent purpose to revoke (stamps the active row; history is kept).',
    enum: ['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'],
    example: 'MEDIA_USAGE',
  })
  @IsEnum(['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'])
  purpose!: 'DATA_PROCESSING' | 'MEDIA_USAGE' | 'MARKETING_NOTICE';

  @ApiPropertyOptional({
    description: 'Revoke on behalf of a linked minor; omitted for self.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
