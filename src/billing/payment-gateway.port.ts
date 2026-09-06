import type { IncomingHttpHeaders } from 'http';

/** A payment the gateway must collect for one order reference (plan 7.5). */
export interface GatewayPaymentRequest {
  orderRef: string;
  /** VND integer. */
  amount: number;
  /** Transfer content; adapters embed the orderRef so webhooks can find it. */
  description: string;
  expiresAt: Date;
}

export interface GatewayPaymentResult {
  checkoutUrl: string;
  qrCodeDataUrl?: string;
}

export interface GatewayWebhookEvent {
  orderRef: string;
  gatewayTxnId: string;
  /** Amount reported by the gateway in VND. */
  amount: number;
  success: boolean;
}

/**
 * PaymentGateway port (plan 7.5): exactly ONE QR gateway behind this interface
 * (payOS or SePay), swappable without touching the billing flow. The simulated
 * adapter implements the same contract for local/e2e runs without credentials.
 */
export interface PaymentGatewayPort {
  readonly provider: 'payos' | 'sepay' | 'simulated';
  createPayment(request: GatewayPaymentRequest): Promise<GatewayPaymentResult>;
  /** Constant-time check of the provider signature over the RAW request body. */
  verifySignature(headers: IncomingHttpHeaders, rawBody: string): boolean;
  /** Returns null for a malformed payload (the caller then rejects the delivery). */
  parseEvent(rawBody: string): GatewayWebhookEvent | null;
}

export const PAYMENT_GATEWAY_PORT: string = 'PAYMENT_GATEWAY_PORT';
