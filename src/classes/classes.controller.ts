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
import { ParseUuidPipe } from '../common/parse-uuid.pipe';
import { ClassesService } from './classes.service';
import {
  CreateClassDto,
  CreateScheduleDto,
  ListClassesQueryDto,
  UpdateClassDto,
} from './dto/classes.dto';

@Controller('classes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  /** Any authenticated role may read classes (plan 8). */
  @Get()
  list(@Query() query: ListClassesQueryDto) {
    return this.classes.list(query);
  }

  @Get(':id')
  getById(@Param('id', ParseUuidPipe) id: string) {
    return this.classes.getById(id);
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateClassDto) {
    return this.classes.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateClassDto) {
    return this.classes.update(id, dto);
  }

  @Post(':id/schedules')
  @Roles('ADMIN')
  addSchedule(@Param('id', ParseUuidPipe) id: string, @Body() dto: CreateScheduleDto) {
    return this.classes.addSchedule(id, dto);
  }

  @Delete(':id/schedules/:scheduleId')
  @Roles('ADMIN')
  @HttpCode(200)
  async removeSchedule(
    @Param('id', ParseUuidPipe) id: string,
    @Param('scheduleId', ParseUuidPipe) scheduleId: string,
  ): Promise<{ removed: boolean }> {
    return this.classes.removeSchedule(id, scheduleId);
  }
}
