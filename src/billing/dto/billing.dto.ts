import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsEnum,
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
import { PageDto } from '../../common/pagination.dto';

export class CreateInvoiceItemDto {
  @ApiProperty({ description: 'Line item description.', example: 'Học phí tháng 9/2026' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  @ApiProperty({ description: 'Quantity (1..1000).', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  @ApiProperty({
    description: 'Unit price in VND (integer); amount = quantity × unitAmount.',
    example: 400000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  unitAmount!: number;
}

export class CreateInvoiceDto {
  @ApiProperty({
    description: 'StudentProfile id the invoice is issued to.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsUUID()
  studentId!: string;

  @ApiProperty({
    description:
      'Invoice type. TUITION requires periodMonth/periodYear and is idempotent per (student, period); other types forbid them.',
    enum: ['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'],
    example: 'OTHER',
  })
  @IsEnum(['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'])
  type!: 'TUITION' | 'EXAM_FEE' | 'UNIFORM' | 'OTHER';

  @ApiProperty({
    description: 'Line items (1..50).',
    type: CreateInvoiceItemDto,
    isArray: true,
    maxItems: 50,
  })
  @Type(() => CreateInvoiceItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  items!: CreateInvoiceItemDto[];

  @ApiPropertyOptional({
    description: 'Manual discount in VND; total = subtotal − discount − code discount; total ≥ 0.',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  discount?: number;

  @ApiPropertyOptional({
    description: 'Payment due date (ISO 8601); defaults to 14 days from now.',
    example: '2026-10-15',
  })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({
    description: 'Free-text note shown on the invoice.',
    example: 'Võ phục mới',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    description: 'Billing period month (1..12); required for TUITION, forbidden otherwise.',
    example: 9,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;

  @ApiPropertyOptional({
    description: 'Billing period year (2000..2100); required for TUITION, forbidden otherwise.',
    example: 2026,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  periodYear?: number;

  @ApiPropertyOptional({
    description:
      'Active discount code ("khuyến mãi") resolved at creation time; its discount is added to any manual discount.',
    example: 'TET2026',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  discountCode?: string;
}

export class ListInvoicesQueryDto extends PageDto {
  @ApiPropertyOptional({
    description: 'Filter by payment status.',
    enum: ['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'],
    example: 'UNPAID',
  })
  @IsOptional()
  @IsEnum(['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'])
  status?: 'UNPAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'REFUNDED';

  @ApiPropertyOptional({
    description: 'Filter by invoice type.',
    enum: ['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'],
    example: 'TUITION',
  })
  @IsOptional()
  @IsEnum(['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'])
  type?: 'TUITION' | 'EXAM_FEE' | 'UNIFORM' | 'OTHER';

  @ApiPropertyOptional({
    description: 'ADMIN filter only; other roles are always scoped to their own/linked students.',
    example: 'c0a80101-7154-4b6d-8f3d-2f1e0d9c9a01',
  })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class GenerateMonthlyDto {
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

  @ApiProperty({
    description: 'Classes to close tuition for; every class needs a configured tuition rate.',
    type: String,
    isArray: true,
    maxItems: 50,
    example: ['9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'],
  })
  @Type(() => String)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  classIds!: string[];
}

export class ConfirmCashDto {
  @ApiPropertyOptional({
    description: 'Note recorded with the cash payment (who paid, receipt number, ...).',
    example: 'Cash at dojo, receipt #014',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PaymentOutcomeDto {
  @ApiProperty({
    description:
      'REFUNDED returns the money; DISPUTED marks the transfer as contested. Only SUCCESS payments qualify.',
    enum: ['REFUNDED', 'DISPUTED'],
    example: 'REFUNDED',
  })
  @IsEnum(['REFUNDED', 'DISPUTED'])
  status!: 'REFUNDED' | 'DISPUTED';

  @ApiPropertyOptional({
    description: 'Reason recorded in the audit trail.',
    example: 'Wrong transfer, refunded in person',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListPaymentsQueryDto {
  @ApiProperty({
    description: 'Invoice id whose payment history to list; ownership guard applies.',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsUUID()
  invoiceId!: string;
}

export class RevenueQueryDto {
  @ApiProperty({
    description: 'Revenue window start (ISO 8601 date, inclusive).',
    example: '2026-09-01',
  })
  @IsDateString()
  from!: string;

  @ApiProperty({
    description: 'Revenue window end (ISO 8601 date, inclusive).',
    example: '2026-09-30',
  })
  @IsDateString()
  to!: string;
}
