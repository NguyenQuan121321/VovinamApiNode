import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

class BankAccountDto {
  @ApiProperty({ description: 'Bank BIN code (Vietnamese bank identifier).', example: '970422' })
  @IsString()
  @MaxLength(20)
  bin!: string;

  @ApiProperty({ description: 'Account number (6..20 digits).', example: '9012345678901' })
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  number!: string;

  @ApiProperty({
    description: 'Registered account holder name.',
    example: 'CONG TY TNHH VOVINAM ANH QUAN',
  })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    description:
      'Plan section 10: fee collection only through the legal entity account (BUSINESS).',
    enum: ['BUSINESS'],
    example: 'BUSINESS',
  })
  @IsString()
  ownerType!: 'BUSINESS';
}

class TuitionRateDto {
  @ApiProperty({
    description: 'Class id the rate applies to (must exist).',
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  })
  @IsUUID()
  classId!: string;

  @ApiProperty({ description: 'Monthly tuition in VND (integer).', example: 400000 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  monthlyAmount!: number;
}

export class UpdateTuitionRatesDto {
  @ApiProperty({
    description:
      'Replaces the whole stored tuition_rates map; unknown class ids are rejected and duplicates within the list fail.',
    type: TuitionRateDto,
    isArray: true,
    maxItems: 500,
  })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TuitionRateDto)
  rates!: TuitionRateDto[];
}

export class UpdateBankAccountDto {
  @ApiProperty({
    description: 'Receiving account for QR payments; must be the legal entity account.',
    type: BankAccountDto,
  })
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount!: BankAccountDto;
}

export class TuitionReportQueryDto {
  @ApiProperty({ description: 'Billing period month (1..12).', example: 9 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({ description: 'Billing period year (2000..2100).', example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

export class CreateDiscountCodeDto {
  @ApiProperty({
    description: 'Code customers quote (unique, case-insensitive; stored uppercase).',
    example: 'TET2026',
  })
  @IsString()
  @MaxLength(40)
  code!: string;

  @ApiPropertyOptional({
    description: 'Internal description.',
    example: 'Tết promotion for tuition',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({
    description: 'Percent discount (1..100). Set exactly ONE of percentOff/amountOff.',
    example: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  percentOff?: number;

  @ApiPropertyOptional({
    description: 'Fixed discount in VND (integer ≥ 1000). Set exactly ONE of percentOff/amountOff.',
    example: 50000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(1_000_000_000)
  amountOff?: number;

  @ApiProperty({
    description: 'First valid moment (ISO 8601 date-time).',
    example: '2026-01-01T00:00:00.000Z',
  })
  @Type(() => Date)
  @IsDate()
  validFrom!: Date;

  @ApiProperty({
    description: 'Last valid moment (ISO 8601 date-time); must be after validFrom.',
    example: '2026-02-28T23:59:59.000Z',
  })
  @Type(() => Date)
  @IsDate()
  validUntil!: Date;
}

export class UpdateDiscountCodeDto {
  @ApiPropertyOptional({ description: 'Internal description.', example: 'Extended to mid-March' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiPropertyOptional({
    description: 'New expiry (ISO 8601 date-time).',
    example: '2026-03-15T23:59:59.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  @ApiPropertyOptional({
    description: 'Deactivate without deleting; inactive codes are refused at invoice time.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
