import { Type } from 'class-transformer';
import {
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
  @IsString()
  @MaxLength(20)
  bin!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(20)
  number!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  /** Plan section 10: fee collection only through the legal entity's account. */
  @IsString()
  ownerType!: 'BUSINESS';
}

class TuitionRateDto {
  @IsUUID()
  classId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  monthlyAmount!: number;
}

export class UpdateTuitionRatesDto {
  /** Replaces the whole stored tuition_rates map (plan 7.7 reads this shape). */
  @ValidateNested({ each: true })
  @Type(() => TuitionRateDto)
  rates!: TuitionRateDto[];
}

export class UpdateBankAccountDto {
  @ValidateNested()
  @Type(() => BankAccountDto)
  bankAccount!: BankAccountDto;
}

export class TuitionReportQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;
}

export class CreateDiscountCodeDto {
  @IsString()
  @MaxLength(40)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  /** Exactly one of the two must be set (application-validated XOR). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  percentOff?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(1_000_000_000)
  amountOff?: number;

  @Type(() => Date)
  @IsDate()
  validFrom!: Date;

  @Type(() => Date)
  @IsDate()
  validUntil!: Date;
}

export class UpdateDiscountCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
