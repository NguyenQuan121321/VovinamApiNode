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
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { ExamsService } from './exams.service';
import {
  CreateBeltExamDto,
  ExamResultDto,
  ListExamsQueryDto,
  RegisterExamDto,
  UpdateBeltExamDto,
} from './dto/exams.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  /** Any authenticated role may browse exams (a student must see what to register for). */
  @Get('belt-exams')
  list(@Query() query: ListExamsQueryDto) {
    return this.exams.list(query);
  }

  @Get('belt-exams/:id')
  getById(@Param('id') id: string) {
    return this.exams.getById(id);
  }

  @Post('belt-exams')
  @Roles('ADMIN')
  create(@Body() dto: CreateBeltExamDto) {
    return this.exams.create(dto);
  }

  @Patch('belt-exams/:id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateBeltExamDto) {
    return this.exams.update(id, dto);
  }

  /** STUDENT self / PARENT verified-link registration (guard 7.3); issues the EXAM_FEE invoice. */
  @Post('belt-exams/:id/register')
  @Roles('STUDENT', 'PARENT')
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RegisterExamDto,
  ) {
    return this.exams.register(user, id, dto);
  }

  /** ADMIN/INSTRUCTOR record the outcome; PASS promotes the student's rank (plan 8). */
  @Post('exam-registrations/:id/result')
  @Roles('ADMIN', 'INSTRUCTOR')
  @HttpCode(200)
  recordResult(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ExamResultDto,
  ) {
    return this.exams.recordResult(user, id, dto);
  }
}
