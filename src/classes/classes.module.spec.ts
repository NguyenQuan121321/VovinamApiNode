import { ClassesModule } from './classes.module';
import { ClassesService } from './classes.service';

describe('ClassesModule (stub until P2)', () => {
  it('keeps module and placeholder service loadable for the coverage floor', () => {
    expect(new ClassesModule()).toBeDefined();
    expect(new ClassesService().implementedInPhase).toBe('P2');
  });
});
