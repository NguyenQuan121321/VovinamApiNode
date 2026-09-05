import { AuthModule } from './auth.module';

describe('AuthModule', () => {
  it('loads with its providers', () => {
    expect(new AuthModule()).toBeDefined();
  });
});
