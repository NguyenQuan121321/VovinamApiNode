import { ClassesModule } from './classes.module';
import { ClassesService } from './classes.service';
import { EnrollmentsService } from './enrollments.service';

describe('ClassesModule', () => {
  it('exposes the module and its services (imported by the attendance module)', () => {
    expect(ClassesModule).toBeDefined();
    expect(ClassesService).toBeDefined();
    expect(EnrollmentsService).toBeDefined();
  });
});
