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
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  /** VND integer. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  unitAmount!: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  studentId!: string;

  @IsEnum(['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'])
  type!: 'TUITION' | 'EXAM_FEE' | 'UNIFORM' | 'OTHER';

  @Type(() => CreateInvoiceItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  items!: CreateInvoiceItemDto[];

  /** VND integer; must not exceed the subtotal. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  discount?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Required for TUITION (drives the monthly idempotency key), forbidden otherwise. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  periodYear?: number;
}

export class ListInvoicesQueryDto extends PageDto {
  @IsOptional()
  @IsEnum(['UNPAID', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED'])
  status?: 'UNPAID' | 'PAID' | 'OVERDUE' | 'CANCELLED' | 'REFUNDED';

  @IsOptional()
  @IsEnum(['TUITION', 'EXAM_FEE', 'UNIFORM', 'OTHER'])
  type?: 'TUITION' | 'EXAM_FEE' | 'UNIFORM' | 'OTHER';

  /** ADMIN filter only; other roles are always scoped to themselves. */
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class GenerateMonthlyDto {
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

  @Type(() => String)
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  classIds!: string[];
}

export class ConfirmCashDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PaymentOutcomeDto {
  @IsEnum(['REFUNDED', 'DISPUTED'])
  status!: 'REFUNDED' | 'DISPUTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListPaymentsQueryDto {
  @IsUUID()
  invoiceId!: string;
}

export class RevenueQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}
