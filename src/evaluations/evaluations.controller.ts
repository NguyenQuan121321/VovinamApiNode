import {
  Body,
  Controller,
  Delete,
  Get,
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
import { EvaluationsService } from './evaluations.service';
import {
  CreateEvaluationDto,
  ListEvaluationsQueryDto,
  UpdateEvaluationDto,
} from './dto/evaluations.dto';

/**
 * Student evaluations (matrix row 12): HLV/Võ sư write, võ sinh reads their own
 * through guard 7.3 (parents likewise through their verified links).
 */
@Controller('evaluations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Post()
  @Roles('ADMIN', 'INSTRUCTOR')
  create(@CurrentUser() caller: AuthenticatedUser, @Body() dto: CreateEvaluationDto) {
    return this.evaluations.create(caller, dto);
  }

  /** Evaluations of one student; guard 7.3 scopes the answer with the 404 posture. */
  @Get()
  listForStudent(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: ListEvaluationsQueryDto,
  ) {
    return this.evaluations.listForStudent(caller, query);
  }

  @Patch(':id')
  @Roles('ADMIN', 'INSTRUCTOR')
  update(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id', ParseUuidPipe) id: string,
    @Body() dto: UpdateEvaluationDto,
  ) {
    return this.evaluations.update(caller, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'INSTRUCTOR')
  delete(@CurrentUser() caller: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.evaluations.delete(caller, id);
  }
}
