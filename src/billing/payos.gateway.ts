import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import type { EnvService } from '../config/env.service';
import type {
  GatewayPaymentRequest,
  GatewayPaymentResult,
  GatewayWebhookEvent,
  PaymentGatewayPort,
} from './payment-gateway.port';

const API_BASE_URL = 'https://api-merchant.payos.vn';
const CREATE_PAYMENT_PATH = '/v2/payment-requests';
const REQUEST_TIMEOUT_MS = 10_000;
/** Same unambiguous alphabet as the orderRef generator in payments.service. */
const ORDER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** The orderRef is embedded in the transfer description (plan 7.5: extract by regex). */
const ORDER_REF_PATTERN = /VV[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}/;

/**
 * payOS orderCode must be a positive number: the 8 orderRef characters encode
 * as a base-32 value (fits 40 bits, far below 2^53). Deterministic, so an
 * orderRef and its gateway order code always correspond 1:1; webhooks are
 * matched through the description regex, never through decoding.
 */
export function orderRefToOrderCode(orderRef: string): number {
  let code = 0;
  for (const char of orderRef.slice(2)) {
    const index = ORDER_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error(`orderRef is not payOS-encodable: ${orderRef}`);
    }
    code = code * 32 + index;
  }
  return code + 1;
}

/**
 * payOS webhook signature canonicalization, verified byte-for-byte against the
 * official @payos/node v2.0.5 source (crypto/node-crypto.js +
 * utils/convert-obj-to-query-str.js): keys sorted ascending, `key=value` pairs
 * joined with '&', array values JSON-stringified with their element keys
 * sorted, null/'null'/'undefined' values become ''.
 */
function payosCanonicalString(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .filter((key) => data[key] !== undefined)
    .map((key) => {
      let value = data[key];
      if (Array.isArray(value)) {
        value = JSON.stringify(
          value.map((entry) =>
            entry !== null && typeof entry === 'object'
              ? Object.keys(entry as Record<string, unknown>)
                  .sort()
                  .reduce<Record<string, unknown>>((sorted, k) => {
                    sorted[k] = (entry as Record<string, unknown>)[k];
                    return sorted;
                  }, {})
              : entry,
          ),
        );
      }
      if (value === null || value === 'undefined' || value === 'null') {
        value = '';
      }
      return `${key}=${String(value)}`;
    })
    .join('&');
}

interface PayosWebhookBody {
  data: Record<string, unknown>;
  signature: unknown;
}

interface PayosCreateResponse {
  code?: unknown;
  desc?: unknown;
  data?: { checkoutUrl?: unknown; qrCode?: unknown } | null;
  signature?: unknown;
}

/**
 * payOS adapter (plan 7.5: exactly ONE primary QR gateway — payOS chosen over
 * SePay at implementation). Implements PaymentGatewayPort over the payOS
 * Merchant API v2 with Node's built-in fetch: payment-request creation signed
 * per the documented 5-field scheme, webhook signatures verified in constant
 * time over the body's canonicalized `data` (the payOS signature lives in the
 * JSON body, not a header). Provider failures surface as 503 through the
 * global exception filter; credentials come from validated env only.
 */
@Injectable()
export class PayosGateway implements PaymentGatewayPort {
  readonly provider = 'payos' as const;

  constructor(private readonly env: EnvService) {}

  async createPayment(request: GatewayPaymentRequest): Promise<GatewayPaymentResult> {
    if (ORDER_REF_PATTERN.test(request.description) === false) {
      // The webhook matches payments by this reference; creating a QR without
      // it in the transfer description would make settlement impossible.
      throw new Error(`description must carry the orderRef for ${request.orderRef}`);
    }
    const body = {
      orderCode: orderRefToOrderCode(request.orderRef),
      amount: request.amount,
      // payOS caps the transfer description at 25 characters; the service
      // builds it as `Vovinam fee ${orderRef}` (22 chars).
      description: request.description,
      returnUrl: this.env.payosReturnUrl,
      cancelUrl: this.env.payosCancelUrl,
      expiredAt: Math.floor(request.expiresAt.getTime() / 1000),
    };
    let response: globalThis.Response;
    try {
      response = await fetch(`${API_BASE_URL}${CREATE_PAYMENT_PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-client-id': this.env.payosClientId,
          'x-api-key': this.env.payosApiKey,
        },
        body: JSON.stringify({ ...body, signature: this.signPaymentRequest(body) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException('Payment gateway is unavailable');
    }
    const payload = (await response.json().catch(() => null)) as PayosCreateResponse | null;
    const checkoutUrl = payload?.data?.checkoutUrl;
    if (!response.ok || payload?.code !== '00' || typeof checkoutUrl !== 'string') {
      throw new ServiceUnavailableException('Payment gateway rejected the payment request');
    }
    const qrCode = payload.data?.qrCode;
    return {
      checkoutUrl,
      ...(typeof qrCode === 'string' && qrCode !== '' ? { qrCodeDataUrl: qrCode } : {}),
    };
  }

  verifySignature(headers: IncomingHttpHeaders, rawBody: string): boolean {
    // payOS v2 signs the canonicalized body data carried INSIDE the JSON body;
    // no signature header is used (unlike the simulated adapter).
    void headers;
    const parsed = this.parseWebhookBody(rawBody);
    if (parsed === null || typeof parsed.signature !== 'string') {
      return false;
    }
    const expected = createHmac('sha256', this.env.payosChecksumKey)
      .update(payosCanonicalString(parsed.data))
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(parsed.signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseEvent(rawBody: string): GatewayWebhookEvent | null {
    const parsed = this.parseWebhookBody(rawBody);
    if (parsed === null) {
      return null;
    }
    const { data } = parsed;
    const description = typeof data.description === 'string' ? data.description : '';
    const orderRef = ORDER_REF_PATTERN.exec(description)?.[0];
    const gatewayTxnId =
      typeof data.reference === 'string' && data.reference !== ''
        ? data.reference
        : typeof data.paymentLinkId === 'string' && data.paymentLinkId !== ''
          ? data.paymentLinkId
          : null;
    const amount =
      typeof data.amount === 'number' && Number.isInteger(data.amount) ? data.amount : null;
    if (orderRef === undefined || gatewayTxnId === null || amount === null) {
      return null;
    }
    // The transaction status is data.code ('00' = transfer succeeded); the
    // outer body code only reports the webhook delivery itself.
    return { orderRef, gatewayTxnId, amount, success: data.code === '00' };
  }

  private parseWebhookBody(rawBody: string): PayosWebhookBody | null {
    try {
      const parsed = JSON.parse(rawBody) as { data?: unknown; signature?: unknown };
      if (parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
        return null;
      }
      return { data: parsed.data as Record<string, unknown>, signature: parsed.signature };
    } catch {
      return null;
    }
  }

  /** SDK v2 signature scheme: HMAC over the five documented request fields. */
  private signPaymentRequest(body: {
    amount: number;
    cancelUrl: string;
    description: string;
    orderCode: number;
    returnUrl: string;
  }): string {
    const dataStr = `amount=${body.amount}&cancelUrl=${body.cancelUrl}&description=${body.description}&orderCode=${body.orderCode}&returnUrl=${body.returnUrl}`;
    return createHmac('sha256', this.env.payosChecksumKey).update(dataStr).digest('hex');
  }
}
