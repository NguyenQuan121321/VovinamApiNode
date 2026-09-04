import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

describe('AuthModule (stub until P1)', () => {
  it('keeps module and placeholder service loadable for the coverage floor', () => {
    expect(new AuthModule()).toBeDefined();
    expect(new AuthService().implementedInPhase).toBe('P1');
  });
});
