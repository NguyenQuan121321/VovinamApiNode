import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class GrantConsentDto {
  @IsEnum(['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'])
  purpose!: 'DATA_PROCESSING' | 'MEDIA_USAGE' | 'MARKETING_NOTICE';

  /**
   * A verified PARENT grants on behalf of a linked MINOR (plan 7.1). Omitted
   * when the account holder consents for themselves.
   */
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class RevokeConsentDto {
  @IsEnum(['DATA_PROCESSING', 'MEDIA_USAGE', 'MARKETING_NOTICE'])
  purpose!: 'DATA_PROCESSING' | 'MEDIA_USAGE' | 'MARKETING_NOTICE';

  @IsOptional()
  @IsUUID()
  studentId?: string;
}
