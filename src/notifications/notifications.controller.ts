import { Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { CurrentUser } from '../auth/guards/current-user.decorator';
import { ParseUuidPipe } from '../common/parse-uuid.pipe';
import { PageDto } from '../common/pagination.dto';
import type { AuthenticatedUser } from '../auth/guards/authenticated-request';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationsService } from './notifications.service';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly outbox: NotificationOutboxService,
  ) {}

  /** Own feed (plan 8): any authenticated role, always scoped to the caller. */
  @Get('notifications/me')
  @HttpCode(200)
  async feed(@CurrentUser() user: AuthenticatedUser, @Query() query: PageDto) {
    return this.notifications.listMine(user, query);
  }

  /** Triggers one worker pass; ops/diagnostics helper for the in-process worker. */
  @Post('admin/notifications/flush')
  @Roles('ADMIN')
  @HttpCode(200)
  async flush() {
    await this.outbox.runOnce();
    return { flushed: true };
  }

  /** Mark one own notification read; foreign ids answer the uniform 404. */
  @Patch('notifications/:id/read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUuidPipe) id: string) {
    return this.notifications.markRead(user, id);
  }
}
