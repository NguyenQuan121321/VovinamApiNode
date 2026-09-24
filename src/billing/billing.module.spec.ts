import { BillingModule, createPaymentGateway } from './billing.module';
import { BillingService } from './billing.service';
import { PayosGateway } from './payos.gateway';
import { SimulatedGateway } from './simulated.gateway';

describe('BillingModule', () => {
  it('exposes the module and its service (imported by the exams module)', () => {
    expect(BillingModule).toBeDefined();
    expect(BillingService).toBeDefined();
  });
});

describe('createPaymentGateway (PAYMENTS_GATEWAY selection)', () => {
  const makeEnv = (gateway: string) => ({ paymentsGateway: gateway }) as never;

  it('selects the simulated adapter for local/e2e runs', () => {
    expect(createPaymentGateway(makeEnv('simulated'))).toBeInstanceOf(SimulatedGateway);
  });

  it('selects the payOS adapter as the real primary channel', () => {
    expect(createPaymentGateway(makeEnv('payos'))).toBeInstanceOf(PayosGateway);
  });

  it('blocks boot on the unimplemented SePay channel (fail-fast, plan 7.5)', () => {
    expect(() => createPaymentGateway(makeEnv('sepay'))).toThrow(/No SePay adapter/);
  });
});
