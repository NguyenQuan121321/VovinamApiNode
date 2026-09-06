import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { CurrentUser } from '../auth/guards/current-user.decorator';
import { ParseUuidPipe } from '../common/parse-uuid.pipe';
import type { RequestWithRawBody } from '../common/request-raw-body';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { BillingService } from './billing.service';
import { PaymentsService } from './payments.service';
import {
  ConfirmCashDto,
  CreateInvoiceDto,
  GenerateMonthlyDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  PaymentOutcomeDto,
  RevenueQueryDto,
} from './dto/billing.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** Role-scoped list: ADMIN all, STUDENT own, PARENT linked (plan 7.4). */
  @Get('invoices')
  @Roles('ADMIN', 'STUDENT', 'PARENT')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListInvoicesQueryDto) {
    return this.billing.list(user, query);
  }

  /** Detail with items; the service answers 404 for instructors (plan 7.4). */
  @Get('invoices/:id')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.billing.getById(user, id);
  }

  @Post('invoices')
  @Roles('ADMIN')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInvoiceDto) {
    return this.billing.create(user, dto);
  }

  /** Monthly tuition close, idempotent per (student, period) (plan 7.7). */
  @Post('admin/billing/generate-monthly')
  @Roles('ADMIN')
  @HttpCode(200)
  generateMonthly(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateMonthlyDto) {
    return this.billing.generateMonthly(user, dto);
  }

  @Get('admin/reports/revenue')
  @Roles('ADMIN')
  revenue(@CurrentUser() user: AuthenticatedUser, @Query() query: RevenueQueryDto) {
    return this.billing.revenue(user, new Date(query.from), new Date(query.to));
  }
}

@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Payer initiates a QR payment; ownership guard scopes the invoice (plan 7.3). */
  @Post('payments/qr/:invoiceId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  createQrPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId', ParseUuidPipe) invoiceId: string,
  ) {
    return this.payments.createQrPayment(user, invoiceId);
  }

  /**
   * Public gateway webhook (plan 7.5): HMAC-verified against the RAW body; 401
   * on a bad signature, 200 for everything else so the gateway stops retrying.
   * Declared before the parameterized cash route so 'webhook' is not captured
   * as an invoice id.
   */
  @Post('payments/webhook/:provider')
  @HttpCode(200)
  webhook(@Param('provider') provider: string, @Req() req: Request) {
    const raw = (req as RequestWithRawBody).rawBody;
    return this.payments.handleWebhook(provider, req.headers, raw?.toString('utf8') ?? '');
  }

  /** ADMIN cash confirmation (plan 7.5, idempotent via the invoice claim). */
  @Post('payments/:invoiceId/confirm-cash')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(200)
  confirmCash(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId', ParseUuidPipe) invoiceId: string,
    @Body() dto: ConfirmCashDto,
  ) {
    return this.payments.confirmCash(user, invoiceId, dto.note);
  }

  /** ADMIN refunds/disputes a successful payment. */
  @Patch('payments/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  setOutcome(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: PaymentOutcomeDto,
  ) {
    return this.payments.setOutcome(user, id, dto.status, dto.note);
  }

  /** Payment history of one invoice, scoped by plan 7.3. */
  @Get('payments')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STUDENT', 'PARENT')
  listForInvoice(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPaymentsQueryDto) {
    return this.payments.listForInvoice(user, query.invoiceId);
  }
}
