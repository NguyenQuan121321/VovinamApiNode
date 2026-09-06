import { createHmac } from 'node:crypto';
import { EnvService } from '../config/env.service';
import { SimulatedGateway } from './simulated.gateway';

const SECRET = 'test-webhook-secret';

function makeGateway(secret?: string): SimulatedGateway {
  const env = { paymentsWebhookSecret: secret } as unknown as EnvService;
  return new SimulatedGateway(env);
}

function sign(body: string, secret: string = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('SimulatedGateway (plan 7.5 stand-in)', () => {
  it('returns a local checkout URL embedding the order reference', async () => {
    const gateway = makeGateway(SECRET);
    const result = await gateway.createPayment({
      orderRef: 'VVABCD2345',
      amount: 500000,
      description: 'Vovinam fee VVABCD2345',
      expiresAt: new Date(),
    });
    expect(result.checkoutUrl).toBe('/api/v1/payments/simulated/VVABCD2345');
  });

  it('verifies valid HMAC signatures in constant time and rejects tampered ones', () => {
    const gateway = makeGateway(SECRET);
    const body = '{"orderRef":"VVABCD2345","amount":500000}';
    expect(gateway.verifySignature({ 'x-signature': sign(body) }, body)).toBe(true);
    expect(gateway.verifySignature({ 'x-signature': sign(body) + '00' }, body)).toBe(false);
    expect(gateway.verifySignature({ 'x-signature': sign(body, 'other-secret') }, body)).toBe(
      false,
    );
  });

  it('fails closed without a signature header or a configured secret', () => {
    const gateway = makeGateway(SECRET);
    const body = '{}';
    expect(gateway.verifySignature({}, body)).toBe(false);

    const unconfigured = makeGateway(undefined);
    expect(unconfigured.verifySignature({ 'x-signature': sign(body) }, body)).toBe(false);

    // Header arrays (repeated headers) use the first value.
    expect(gateway.verifySignature({ 'x-signature': [sign(body), 'junk'] }, body)).toBe(true);
  });

  it('parses well-formed events and rejects malformed payloads', () => {
    const gateway = makeGateway(SECRET);
    expect(
      gateway.parseEvent(
        '{"orderRef":"VVABCD2345","gatewayTxnId":"GW-1","amount":500,"success":true}',
      ),
    ).toEqual({ orderRef: 'VVABCD2345', gatewayTxnId: 'GW-1', amount: 500, success: true });
    // success anything but true reads as a failed transfer.
    expect(
      gateway.parseEvent('{"orderRef":"VVABCD2345","gatewayTxnId":"GW-1","amount":500}'),
    ).toEqual({ orderRef: 'VVABCD2345', gatewayTxnId: 'GW-1', amount: 500, success: false });
    expect(gateway.parseEvent('{"orderRef":"VVABCD2345"}')).toBeNull();
    expect(gateway.parseEvent('{"orderRef":12,"gatewayTxnId":"GW-1","amount":5}')).toBeNull();
    expect(gateway.parseEvent('not json')).toBeNull();
  });
});
