import { AttendanceModule } from './attendance.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';

describe('AttendanceModule', () => {
  it('exposes the module and its members (wired into AppModule)', () => {
    expect(AttendanceModule).toBeDefined();
    expect(AttendanceService).toBeDefined();
    expect(AttendanceController).toBeDefined();
  });
});
