import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { CurrentUser } from '../auth/guards/current-user.decorator';
import { ParseUuidPipe } from '../common/parse-uuid.pipe';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { PromotionsService } from './promotions.service';
import {
  CreatePromotionProposalDto,
  ListProposalsQueryDto,
  ReviewProposalDto,
  UpdateProposalDto,
} from './dto/promotions.dto';

/**
 * Promotion proposals (matrix row 14): HLV proposes (C), Võ sư approves (A),
 * students see their own (V). Instructors propose only for own-class students —
 * the ownership guard enforces it with the uniform 404.
 */
@Controller('promotion-proposals')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Post()
  @Roles('ADMIN', 'INSTRUCTOR')
  create(@CurrentUser() caller: AuthenticatedUser, @Body() dto: CreatePromotionProposalDto) {
    return this.promotions.create(caller, dto);
  }

  @Get()
  @Roles('ADMIN', 'INSTRUCTOR', 'STUDENT', 'PARENT')
  list(@CurrentUser() caller: AuthenticatedUser, @Query() query: ListProposalsQueryDto) {
    return this.promotions.list(caller, query);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INSTRUCTOR')
  updateNote(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateProposalDto,
  ) {
    return this.promotions.updateNote(caller, id, dto);
  }

  @Post(':id/review')
  @HttpCode(200)
  @Roles('ADMIN')
  review(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ReviewProposalDto,
  ) {
    return this.promotions.review(caller, id, dto);
  }
}
