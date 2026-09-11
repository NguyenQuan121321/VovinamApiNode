import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { IncomingHttpHeaders } from 'http';
import type { EnvService } from '../config/env.service';
import type {
  GatewayPaymentRequest,
  GatewayPaymentResult,
  GatewayWebhookEvent,
  PaymentGatewayPort,
} from './payment-gateway.port';

const SIGNATURE_HEADER = 'x-signature';

/**
 * Local/e2e stand-in for payOS/SePay (plan stop rules: never fabricate provider
 * credentials). Implements the same port: createPayment returns a placeholder
 * checkout URL, and webhooks are HMAC-SHA256 signed over the raw body with
 * PAYMENTS_WEBHOOK_SECRET, verified in constant time.
 */
@Injectable()
export class SimulatedGateway implements PaymentGatewayPort {
  readonly provider = 'simulated' as const;

  constructor(private readonly env: EnvService) {}

  async createPayment(request: GatewayPaymentRequest): Promise<GatewayPaymentResult> {
    return {
      checkoutUrl: `/api/v1/payments/simulated/${request.orderRef}`,
    };
  }

  verifySignature(headers: IncomingHttpHeaders, rawBody: string): boolean {
    const secret = this.env.paymentsWebhookSecret;
    const provided = headers[SIGNATURE_HEADER];
    const providedValue = typeof provided === 'string' ? provided : provided?.[0];
    if (secret === undefined || providedValue === undefined) {
      return false;
    }
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(providedValue, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parseEvent(rawBody: string): GatewayWebhookEvent | null {
    try {
      const parsed = JSON.parse(rawBody) as {
        orderRef?: unknown;
        gatewayTxnId?: unknown;
        amount?: unknown;
        success?: unknown;
      };
      const orderRef = typeof parsed.orderRef === 'string' ? parsed.orderRef : null;
      const gatewayTxnId = typeof parsed.gatewayTxnId === 'string' ? parsed.gatewayTxnId : null;
      const amount = typeof parsed.amount === 'number' ? parsed.amount : null;
      if (orderRef === null || gatewayTxnId === null || amount === null) {
        return null;
      }
      return { orderRef, gatewayTxnId, amount, success: parsed.success === true };
    } catch {
      return null;
    }
  }
}
