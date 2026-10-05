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
  private activePass: Promise<void> | null = null;
  private stopping = false;

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

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
    await this.activePass;
  }

  /**
   * One worker pass. Claim-first (QUEUED -> SENDING) so duplicate or overlapping
   * passes cannot double-send; a crashed pass leaves SENDING rows that the next
   * boot treats as stale (claim guard below). Never throws into the interval.
   */
  runOnce(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    this.activePass ??= this.processBatch().finally(() => {
      this.activePass = null;
    });
    return this.activePass;
  }

  private async processBatch(): Promise<void> {
    try {
      const staleSendingBefore = new Date(Date.now() - 10 * 60_000);
      await this.prisma.notification.updateMany({
        where: {
          status: 'SENDING',
          OR: [
            { claimedAt: { lt: staleSendingBefore } },
            { claimedAt: null, createdAt: { lt: staleSendingBefore } },
          ],
        },
        data: { status: 'QUEUED', claimedAt: null },
      });
      for (let attempt = 0; attempt < 50 && !this.stopping; attempt += 1) {
        const row = await this.prisma.$transaction(async (tx) => {
          const candidates = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM "notifications" WHERE status = 'QUEUED'
              AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`;
          const candidate = candidates[0];
          if (candidate === undefined) return null;
          await tx.notification.updateMany({
            where: { id: candidate.id, status: 'QUEUED' },
            data: { status: 'SENDING', claimedAt: new Date() },
          });
          return tx.notification.findUnique({ where: { id: candidate.id } });
        });
        if (row === null) break;
        await this.deliver(row);
      }
    } catch {
      this.logger.error({}, 'notification_worker_pass_failed');
    }
  }

  private channelChain(
    channel: NotificationChannel,
  ): Array<{ channel: NotificationChannel; sender: ChannelSender }> {
    // Plan 7.6 fallback chain: ZNS -> SMS -> email. INAPP never enters the worker.
    switch (channel) {
      case 'ZNS':
        return [
          { channel: 'ZNS', sender: this.zns },
          { channel: 'SMS', sender: this.sms },
          { channel: 'EMAIL', sender: this.mailSenderAdapter() },
        ];
      case 'SMS':
        return [
          { channel: 'SMS', sender: this.sms },
          { channel: 'EMAIL', sender: this.mailSenderAdapter() },
        ];
      default:
        return [{ channel: 'EMAIL', sender: this.mailSenderAdapter() }];
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
    for (const { sender, channel } of this.channelChain(row.channel)) {
      try {
        await sender.send(message);
        await this.prisma.notification.update({
          where: { id: row.id },
          data: {
            status: 'SENT' satisfies NotificationStatus,
            sentAt: new Date(),
            error: null,
            nextAttemptAt: null,
            claimedAt: null,
            payload: {
              ...(message.payload ?? {}),
              deliveredVia: channel,
            } as Prisma.InputJsonValue,
          },
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === 'UnconfiguredChannelError') {
          continue; // try the next channel in the fallback chain
        }
        await this.recordFailure(row, 'Notification delivery failed');
        return;
      }
    }
    // Every chain link unconfigured: keep the row queued for the next pass
    // (config may arrive without a redeploy), counting it as a failure so the
    // bounded-retry cap still applies.
    await this.recordFailure(row, 'No delivery channel configured');
  }

  private async recordFailure(
    row: { id: string; retries: number },
    message: string,
  ): Promise<void> {
    const retries = row.retries + 1;
    const exhausted = retries >= MAX_RETRIES;
    await this.prisma.notification.update({
      where: { id: row.id },
      data: {
        status: (exhausted ? 'FAILED' : 'QUEUED') satisfies NotificationStatus,
        retries,
        error: message,
        claimedAt: null,
        nextAttemptAt: exhausted ? null : new Date(Date.now() + backoffMs(retries - 1)),
      },
    });
  }
}
