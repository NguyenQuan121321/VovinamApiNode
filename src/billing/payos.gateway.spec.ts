import { ServiceUnavailableException } from '@nestjs/common';
import { PayosGateway, orderRefToOrderCode } from './payos.gateway';
import type { EnvService } from '../config/env.service';

/**
 * Signature vectors were produced by running the OFFICIAL @payos/node v2.0.5
 * crypto provider (crypto/node-crypto.js) over these exact payloads, so the
 * canonicalization is pinned to the published SDK behavior, not to itself.
 */
const CHECKSUM_KEY = 'e2e-payos-checksum-key-0123456789abcdef';
const WEBHOOK_DATA = {
  orderCode: 123847123,
  amount: 250000,
  description: 'Vovinam fee VVAB234XYZ',
  accountNumber: '12345678',
  reference: 'TF230204212323',
  transactionDateTime: '2026-09-24 18:25:00',
  currency: 'VND',
  paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
  code: '00',
  desc: 'success',
  counterAccountBankId: null,
  counterAccountBankName: null,
  counterAccountName: null,
  counterAccountNumber: null,
  virtualAccountName: null,
  virtualAccountNumber: null,
};
const WEBHOOK_SIGNATURE = '70e466d21b0f2f24cd627bb71c073d3b8c170575817acb0aff763baa6f866ff9';

function makeEnv(): EnvService {
  return {
    payosClientId: 'test-client-id',
    payosApiKey: 'test-api-key',
    payosChecksumKey: CHECKSUM_KEY,
    payosReturnUrl: 'https://app.example.com/payments/return',
    payosCancelUrl: 'https://app.example.com/payments/cancel',
  } as unknown as EnvService;
}

function makeGateway(): PayosGateway {
  return new PayosGateway(makeEnv());
}

interface FetchCall {
  url: string;
  init?: RequestInit;
}

let fetchCalls: FetchCall[] = [];

function mockFetch(payload: unknown, ok = true, status = 200): void {
  fetchCalls = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    fetchCalls.push({ url: String(input), init });
    return { ok, status, json: async () => payload } as unknown as Response;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('orderRefToOrderCode', () => {
  it('encodes deterministically and stays a positive 2^53-safe integer', () => {
    expect(orderRefToOrderCode('VVAB234XYZ')).toBe(1906136792);
    expect(orderRefToOrderCode('VVAAAAAAAA')).toBe(1);
    expect(orderRefToOrderCode('VVAB234XYZ')).toBe(orderRefToOrderCode('VVAB234XYZ'));
  });

  it('rejects references outside the unambiguous alphabet', () => {
    expect(() => orderRefToOrderCode('VV0O1I5S8')).toThrow(/not payOS-encodable/);
  });
});

describe('PayosGateway.createPayment', () => {
  const request = {
    orderRef: 'VVAB234XYZ',
    amount: 250000,
    description: 'Vovinam fee VVAB234XYZ',
    expiresAt: new Date('2026-09-24T19:00:00.000Z'),
  };

  it('posts the signed payment request to the payOS merchant API', async () => {
    mockFetch({
      code: '00',
      desc: 'success',
      data: {
        checkoutUrl: 'https://pay.payos.vn/abc/checkout',
        qrCode: 'data:image/png;base64,AAAA',
      },
    });
    const result = await makeGateway().createPayment(request);
    expect(result.checkoutUrl).toBe('https://pay.payos.vn/abc/checkout');
    expect(result.qrCodeDataUrl).toBe('data:image/png;base64,AAAA');

    expect(fetchCalls).toHaveLength(1);
    const { url, init } = fetchCalls[0] as FetchCall;
    expect(url).toBe('https://api-merchant.payos.vn/v2/payment-requests');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-client-id']).toBe('test-client-id');
    expect(headers['x-api-key']).toBe('test-api-key');
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body.orderCode).toBe(1906136792);
    expect(body.amount).toBe(250000);
    expect(body.description).toBe('Vovinam fee VVAB234XYZ');
    expect(body.returnUrl).toBe('https://app.example.com/payments/return');
    expect(body.cancelUrl).toBe('https://app.example.com/payments/cancel');
    expect(body.expiredAt).toBe(1790276400);
    // Vector from the official SDK's createSignatureOfPaymentRequest scheme.
    expect(body.signature).toBe('4249dd7fd9bf55ea2c05075da81a3e13ad053c1eb6c02255c585166cf2e84188');
  });

  it('refuses to create a QR whose description would not match a webhook', async () => {
    fetchCalls = [];
    await expect(
      makeGateway().createPayment({ ...request, description: 'no reference here' }),
    ).rejects.toThrow(/must carry the orderRef/);
    expect(fetchCalls).toHaveLength(0);
  });

  it('maps provider rejections and network failures to 503', async () => {
    mockFetch({ code: 'PAYOS_101', desc: 'invalid signature' }, false, 401);
    await expect(makeGateway().createPayment(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(makeGateway().createPayment(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    mockFetch({ code: '00', data: null });
    await expect(makeGateway().createPayment(request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('PayosGateway.verifySignature', () => {
  const headers = {};

  it('accepts a webhook signed per the payOS scheme (SDK-verified vector)', () => {
    const rawBody = JSON.stringify({
      code: '00',
      id: '123',
      desc: 'success',
      data: WEBHOOK_DATA,
      signature: WEBHOOK_SIGNATURE,
    });
    expect(makeGateway().verifySignature(headers, rawBody)).toBe(true);
  });

  it('rejects tampered data, missing signatures, and garbage bodies', () => {
    const tampered = JSON.stringify({
      code: '00',
      desc: 'success',
      data: { ...WEBHOOK_DATA, amount: 1 },
      signature: WEBHOOK_SIGNATURE,
    });
    expect(makeGateway().verifySignature(headers, tampered)).toBe(false);

    const unsigned = JSON.stringify({ code: '00', desc: 'success', data: WEBHOOK_DATA });
    expect(makeGateway().verifySignature(headers, unsigned)).toBe(false);

    expect(makeGateway().verifySignature(headers, 'not-json')).toBe(false);
    expect(makeGateway().verifySignature(headers, JSON.stringify({ data: 'flat' }))).toBe(false);
  });
});

describe('PayosGateway.parseEvent', () => {
  it('maps a successful transfer to the gateway event contract', () => {
    const rawBody = JSON.stringify({
      code: '00',
      desc: 'success',
      data: WEBHOOK_DATA,
      signature: WEBHOOK_SIGNATURE,
    });
    expect(makeGateway().parseEvent(rawBody)).toEqual({
      orderRef: 'VVAB234XYZ',
      gatewayTxnId: 'TF230204212323',
      amount: 250000,
      success: true,
    });
  });

  it('falls back to the paymentLinkId when no bank reference exists', () => {
    const withoutReference: Record<string, unknown> = { ...WEBHOOK_DATA };
    delete withoutReference.reference;
    const rawBody = JSON.stringify({
      code: '00',
      desc: 'success',
      data: withoutReference,
      signature: 'sig',
    });
    expect(makeGateway().parseEvent(rawBody)).toMatchObject({
      gatewayTxnId: '124c33293c43417ab7879e14c8d9eb18',
    });
  });

  it('reports failure for non-00 transaction codes', () => {
    const rawBody = JSON.stringify({
      code: '00',
      desc: 'success',
      data: { ...WEBHOOK_DATA, code: 'PA23' },
      signature: 'sig',
    });
    expect(makeGateway().parseEvent(rawBody)).toMatchObject({ success: false });
  });

  it('returns null for payloads without a matchable order or malformed JSON', () => {
    // payOS URL-confirmation probe: signed, but not a payment event.
    const confirm = JSON.stringify({
      code: '00',
      desc: 'success',
      data: { orderCode: 123 },
      signature: 'sig',
    });
    expect(makeGateway().parseEvent(confirm)).toBeNull();
    expect(makeGateway().parseEvent('not-json')).toBeNull();
    expect(makeGateway().parseEvent(JSON.stringify({ data: null, signature: 'sig' }))).toBeNull();
  });
});
