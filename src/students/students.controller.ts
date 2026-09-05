import {
  Body,
  Controller,
  Delete,
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
import { StudentsService } from './students.service';
import { CreateStudentDto, ListStudentsQueryDto, UpdateStudentDto } from './dto/students.dto';

@Controller('students')
@UseGuards(JwtAuthGuard, RolesGuard)
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  /** STUDENT: view own profile on the web (plan 8). Must precede the :id route. */
  @Get('me')
  @Roles('STUDENT')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.students.myProfile(user);
  }

  @Get()
  @Roles('ADMIN', 'INSTRUCTOR')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStudentsQueryDto) {
    return this.students.list(user, query);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateStudentDto) {
    return this.students.create(dto);
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.students.getById(user, id);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateStudentDto) {
    return this.students.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  async softDelete(@Param('id') id: string): Promise<{ deleted: boolean }> {
    return this.students.softDelete(id);
  }

  @Post(':id/invite-code')
  @Roles('ADMIN')
  @HttpCode(200)
  regenerateInviteCode(@Param('id') id: string) {
    return this.students.regenerateInviteCode(id);
  }
}
