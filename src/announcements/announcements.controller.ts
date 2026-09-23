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
import { ParseUuidPipe } from '../common/parse-uuid.pipe';
import { AnnouncementsService } from './announcements.service';
import {
  CreateAnnouncementDto,
  ListAnnouncementsQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  /** Club-activity feed (plan 8): any authenticated role, audience-scoped. */
  @Get('announcements')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListAnnouncementsQueryDto) {
    return this.announcements.list(user, query);
  }

  @Post('announcements')
  @Roles('ADMIN')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(user, dto);
  }

  @Patch('announcements/:id')
  @Roles('ADMIN')
  update(@Param('id', ParseUuidPipe) id: string, @Body() dto: UpdateAnnouncementDto) {
    return this.announcements.update(id, dto);
  }

  @Delete('announcements/:id')
  @Roles('ADMIN')
  @HttpCode(200)
  async remove(@Param('id', ParseUuidPipe) id: string): Promise<{ deleted: boolean }> {
    return this.announcements.remove(id);
  }
}
