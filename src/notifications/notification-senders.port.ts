import type { NotificationChannel } from '@prisma/client';

export interface OutboundMessage {
  channel: NotificationChannel;
  templateCode: string;
  /** Full recipient payload exactly as stored on the outbox row. */
  payload: Record<string, unknown>;
}

export const ZNS_SENDER_PORT = Symbol('ZNS_SENDER_PORT');
export const SMS_SENDER_PORT = Symbol('SMS_SENDER_PORT');

/**
 * Delivery boundary for one ZNS/SMS provider call (plan 7.6). Implementations
 * throw on failure; the worker's fallback chain decides what a failure means.
 */
export interface ChannelSender {
  send(message: OutboundMessage): Promise<void>;
}

/** Raised by a sender whose provider credentials are absent (plan stop rules). */
export class UnconfiguredChannelError extends Error {
  constructor(channel: 'ZNS' | 'SMS') {
    super(`The ${channel} sender is not implemented yet; delivery falls back to EMAIL`);
    this.name = 'UnconfiguredChannelError';
  }
}
