import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { LeavesService } from './leaves.service';
import {
  CreateLeaveRequestDto,
  ListLeaveRequestsQueryDto,
  ReviewLeaveRequestDto,
} from './dto/leaves.dto';

/**
 * Absence requests (matrix row 11): võ sinh creates, HLV/Võ sư reviews, ADMIN
 * manages. Võ sư operates through the ADMIN role (AD-02).
 */
@Controller('leave-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeavesController {
  constructor(private readonly leaves: LeavesService) {}

  @Post()
  @Roles('ADMIN', 'STUDENT', 'PARENT')
  create(@CurrentUser() caller: AuthenticatedUser, @Body() dto: CreateLeaveRequestDto) {
    return this.leaves.create(caller, dto);
  }

  /** Role-scoped list: ADMIN all, INSTRUCTOR own classes, STUDENT/PARENT own (guard 7.3). */
  @Get()
  @Roles('ADMIN', 'INSTRUCTOR', 'STUDENT', 'PARENT')
  list(@CurrentUser() caller: AuthenticatedUser, @Query() query: ListLeaveRequestsQueryDto) {
    return this.leaves.list(caller, query);
  }

  @Post(':id/review')
  @HttpCode(200)
  @Roles('ADMIN', 'INSTRUCTOR')
  review(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: ReviewLeaveRequestDto,
  ) {
    return this.leaves.review(caller, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('ADMIN', 'STUDENT', 'PARENT')
  cancel(@CurrentUser() caller: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.leaves.cancel(caller, id);
  }

  @Delete(':id')
  @Roles('ADMIN')
  delete(@CurrentUser() caller: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.leaves.delete(caller, id);
  }
}
