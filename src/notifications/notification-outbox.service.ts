import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, type NotificationChannel, type NotificationStatus } from '@prisma/client';
import type { Logger } from 'pino';
import { MAIL_PORT, type MailPort } from '../auth/mail/mail.port';
import { APP_LOGGER } from '../logging/pino-logger.factory';
import { PrismaService } from '../prisma/prisma.service';
import {
  SMS_SENDER_PORT,
  ZNS_SENDER_PORT,
  type ChannelSender,
  type OutboundMessage,
} from './notification-senders.port';

/** Works with PrismaService or a transaction client so business callers stay atomic. */
export type PrismaClientLike = PrismaService | Prisma.TransactionClient;

const POLL_INTERVAL_MS = 30_000;
const MAX_RETRIES = 5;
/** 30s * 2^n: 30s, 60s, 120s, 240s, 480s before the row turns FAILED. */
const backoffMs = (retries: number): number => 30_000 * 2 ** retries;

export interface EnqueueInput {
  userId: string;
  channel: NotificationChannel;
  templateCode: string;
  payload: Record<string, unknown>;
}

/**
 * Notification outbox (plan 7.6). Business state changes and their outbox rows
 * commit in ONE transaction via enqueue(); the in-process worker then delivers
 * QUEUED rows with bounded retry/backoff and the ZNS -> SMS -> EMAIL fallback
 * chain. No Redis, no external queue (plan section 3). INAPP rows are
 * "delivered" at insert (status SENT) and served by the feed endpoints.
 */
@Injectable()
export class NotificationOutboxService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    @Inject(ZNS_SENDER_PORT) private readonly zns: ChannelSender,
    @Inject(SMS_SENDER_PORT) private readonly sms: ChannelSender,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  /** QUEUED row inside the caller's transaction (or standalone via PrismaService). */
  async enqueue(tx: PrismaClientLike, input: EnqueueInput): Promise<{ id: string }> {
    const row = await tx.notification.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        templateCode: input.templateCode,
        payload: input.payload as Prisma.InputJsonValue,
        status: 'QUEUED',
      },
      select: { id: true },
    });
    return row;
  }

  /** INAPP message: delivered to the feed the moment the row commits. */
  async enqueueInApp(
    tx: PrismaClientLike,
    input: Omit<EnqueueInput, 'channel'>,
  ): Promise<{ id: string }> {
    const row = await tx.notification.create({
      data: {
        userId: input.userId,
        channel: 'INAPP',
        templateCode: input.templateCode,
        payload: input.payload as Prisma.InputJsonValue,
        status: 'SENT',
        sentAt: new Date(),
      },
      select: { id: true },
    });
    return row;
  }

  async onModuleInit(): Promise<void> {
    this.timer = setInterval(() => void this.runOnce(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
  }

  /**
   * One worker pass. Claim-first (QUEUED -> SENDING) so duplicate or overlapping
   * passes cannot double-send; a crashed pass leaves SENDING rows that the next
   * boot treats as stale (claim guard below). Never throws into the interval.
   */
  async runOnce(): Promise<void> {
    if (this.processing) {
      return;
    }
    this.processing = true;
    try {
      const staleSendingBefore = new Date(Date.now() - 10 * 60_000);
      // Rows stuck in SENDING (process died mid-send) go back to QUEUED after 10 min.
      await this.prisma.notification.updateMany({
        where: { status: 'SENDING', createdAt: { lt: staleSendingBefore } },
        data: { status: 'QUEUED' },
      });
      await this.prisma.notification.updateMany({
        where: {
          status: 'QUEUED',
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        data: { status: 'SENDING' },
      });
      const claimed = await this.prisma.notification.findMany({
        where: { status: 'SENDING' },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
      for (const row of claimed) {
        await this.deliver(row);
      }
    } catch (error) {
      this.logger.error({ err: error }, 'notification_worker_pass_failed');
    } finally {
      this.processing = false;
    }
  }

  private channelChain(channel: NotificationChannel): ChannelSender[] {
    // Plan 7.6 fallback chain: ZNS -> SMS -> email. INAPP never enters the worker.
    switch (channel) {
      case 'ZNS':
        return [this.zns, this.sms, this.mailSenderAdapter()];
      case 'SMS':
        return [this.sms, this.mailSenderAdapter()];
      default:
        return [this.mailSenderAdapter()];
    }
  }

  private mailSenderAdapter(): ChannelSender {
    return {
      send: async (message: OutboundMessage) => {
        const to = message.payload.email;
        if (typeof to !== 'string' || to === '') {
          throw new Error('missing payload.email recipient');
        }
        const text = message.payload.message;
        await this.mail.send({
          to,
          subject: `[Vovinam club] ${message.templateCode}`,
          body: typeof text === 'string' ? text : JSON.stringify(message.payload),
          templateCode: message.templateCode,
        });
      },
    };
  }

  private async deliver(row: {
    id: string;
    channel: NotificationChannel;
    templateCode: string;
    payload: Prisma.JsonValue;
    retries: number;
  }): Promise<void> {
    const message: OutboundMessage = {
      channel: row.channel,
      templateCode: row.templateCode,
      payload: (row.payload ?? {}) as Record<string, unknown>,
    };
    for (const sender of this.channelChain(row.channel)) {
      try {
        await sender.send(message);
        await this.prisma.notification.update({
          where: { id: row.id },
          data: {
            status: 'SENT' satisfies NotificationStatus,
            sentAt: new Date(),
            error: null,
            nextAttemptAt: null,
            payload: {
              ...(message.payload ?? {}),
              deliveredVia: row.channel,
            } as Prisma.InputJsonValue,
          },
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'UnconfiguredChannelError') {
          continue; // try the next channel in the fallback chain
        }
        await this.recordFailure(row, error);
        return;
      }
    }
    // Every chain link unconfigured: keep the row queued for the next pass
    // (config may arrive without a redeploy), counting it as a failure so the
    // bounded-retry cap still applies.
    await this.recordFailure(row, new Error('no delivery channel available'));
  }

  private async recordFailure(row: { id: string; retries: number }, error: unknown): Promise<void> {
    const retries = row.retries + 1;
    const exhausted = retries >= MAX_RETRIES;
    await this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: (exhausted ? 'FAILED' : 'QUEUED') satisfies NotificationStatus,
        retries,
        error: error instanceof Error ? error.message.slice(0, 500) : 'unknown delivery error',
        nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(retries)),
      },
    });
  }
}
