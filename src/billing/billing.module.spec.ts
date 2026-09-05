import { BillingModule } from './billing.module';
import { BillingService } from './billing.service';

describe('BillingModule', () => {
  it('exposes the module and its service (imported by the exams module)', () => {
    expect(BillingModule).toBeDefined();
    expect(BillingService).toBeDefined();
  });
});
