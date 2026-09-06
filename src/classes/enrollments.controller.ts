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
import { EnrollmentsService } from './enrollments.service';
import { CreateEnrollmentDto, ListEnrollmentsQueryDto } from './dto/enrollments.dto';
import { ParseUuidPipe } from '../common/parse-uuid.pipe';

@Controller('enrollments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Post()
  create(@Body() dto: CreateEnrollmentDto) {
    return this.enrollments.create(dto);
  }

  @Get()
  list(@Query() query: ListEnrollmentsQueryDto) {
    return this.enrollments.list(query);
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseUuidPipe) id: string): Promise<{ left: boolean }> {
    return this.enrollments.remove(id);
  }
}
