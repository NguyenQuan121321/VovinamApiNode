import { Injectable } from '@nestjs/common';
import {
  UnconfiguredChannelError,
  type ChannelSender,
  type OutboundMessage,
} from './notification-senders.port';

/**
 * Placeholder ZNS/eSMS senders until the club's Zalo OA and eSMS credentials
 * exist (plan 7.6 risk register; same stop rule as the payOS/SePay payment
 * adapters). They never fabricate a send: the worker treats the
 * UnconfiguredChannelError as "skip this channel" and walks the fallback chain
 * to EMAIL. When real credentials arrive, real adapters replace these behind
 * the same port.
 */
@Injectable()
export class ZnsStubSender implements ChannelSender {
  async send(_message: OutboundMessage): Promise<void> {
    throw new UnconfiguredChannelError('ZNS');
  }
}

@Injectable()
export class SmsStubSender implements ChannelSender {
  async send(_message: OutboundMessage): Promise<void> {
    throw new UnconfiguredChannelError('SMS');
  }
}
