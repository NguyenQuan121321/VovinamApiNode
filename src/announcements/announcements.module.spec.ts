import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsModule } from './announcements.module';

describe('AnnouncementsModule', () => {
  it('exposes the module and its controller', () => {
    expect(AnnouncementsModule).toBeDefined();
    expect(AnnouncementsController).toBeDefined();
  });
});
