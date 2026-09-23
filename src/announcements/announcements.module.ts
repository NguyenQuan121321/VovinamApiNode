import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

/** Club activity announcements (plan sections 6, 8; AD-07). */
@Module({
  imports: [AuthModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService],
})
export class AnnouncementsModule {}
