import { ConsentController } from './consent.controller';
import { ConsentModule } from './consent.module';

describe('ConsentModule', () => {
  it('exposes the module and its controller', () => {
    expect(ConsentModule).toBeDefined();
    expect(ConsentController).toBeDefined();
  });
});
