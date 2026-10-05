import { Prisma } from '@prisma/client';
import { NotificationOutboxService } from './notification-outbox.service';
import { UnconfiguredChannelError } from './notification-senders.port';
import { PrismaService } from '../prisma/prisma.service';
import type { MailPort } from '../auth/mail/mail.port';
import type { Logger } from 'pino';

type Row = {
  id: string;
  channel: 'EMAIL' | 'ZNS' | 'SMS' | 'INAPP';
  templateCode: string;
  payload: Prisma.JsonValue;
  retries: number;
  status: string;
  sentAt: Date | null;
  error: string | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  claimedAt: Date | null;
};

function makePrismaMock() {
  const rows: Row[] = [];
  const prismaForTransaction = {
    rows,
    notification: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'new-notif',
        ...data,
      })),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { status?: string; id?: string; OR?: unknown };
          data: Partial<Row>;
        }) => {
          let moved = 0;
          for (const row of rows) {
            if (where.status !== undefined && row.status !== where.status) {
              continue;
            }
            if (where.id !== undefined && row.id !== where.id) continue;
            if (
              where.OR !== undefined &&
              (row.claimedAt ?? row.createdAt).getTime() >= Date.now() - 10 * 60_000
            )
              continue;
            Object.assign(row, data);
            moved += 1;
          }
          return { count: moved };
        },
      ),
      findMany: jest.fn(async () => rows.filter((row) => row.status === 'SENDING')),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
      ),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (row !== undefined) {
          Object.assign(row, data);
        }
        return row;
      }),
    },
    $queryRaw: jest.fn(async () =>
      rows
        .filter(
          (row) =>
            row.status === 'QUEUED' &&
            (row.nextAttemptAt === null || row.nextAttemptAt <= new Date()),
        )
        .slice(0, 1)
        .map((row) => ({ id: row.id })),
    ),
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      callback(prismaForTransaction),
    ),
  };
  return prismaForTransaction;
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

function makeService(prisma: PrismaMock) {
  const mail = { send: jest.fn().mockResolvedValue(undefined) };
  const zns = { send: jest.fn().mockRejectedValue(new UnconfiguredChannelError('ZNS')) };
  const sms = { send: jest.fn().mockRejectedValue(new UnconfiguredChannelError('SMS')) };
  const logger = { error: jest.fn(), info: jest.fn() };
  const service = new NotificationOutboxService(
    prisma as unknown as PrismaService,
    mail as unknown as MailPort,
    zns,
    sms,
    logger as unknown as Logger,
  );
  return {
    service,
    mail: mail.send as jest.Mock,
    zns: zns.send as jest.Mock,
    sms: sms.send as jest.Mock,
  };
}

function queuedRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'n-1',
    channel: 'EMAIL',
    templateCode: 'tuition_due',
    payload: { message: 'Tuition is due', email: 'student@example.com' },
    retries: 0,
    status: 'QUEUED',
    sentAt: null,
    error: null,
    nextAttemptAt: null,
    createdAt: new Date(),
    claimedAt: null,
    ...overrides,
  };
}

describe('NotificationOutboxService', () => {
  let prisma: PrismaMock;
  let service: NotificationOutboxService;
  let mail: jest.Mock;
  let zns: jest.Mock;
  let sms: jest.Mock;

  beforeEach(() => {
    prisma = makePrismaMock();
    ({ service, mail, zns, sms } = makeService(prisma));
  });

  const firstRow = (): Row => {
    const row = prisma.rows[0];
    if (row === undefined) {
      throw new Error('expected a claimed row');
    }
    return row;
  };

  const txLike = () =>
    ({ notification: prisma.notification }) as unknown as Prisma.TransactionClient;

  it('enqueues INAPP rows already SENT (delivered to the feed at insert)', async () => {
    const row = await service.enqueueInApp(txLike(), {
      userId: 'u-1',
      templateCode: 'invoice_issued',
      payload: { message: 'hi' },
    });
    expect(row.id).toBe('new-notif');
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          channel: 'INAPP',
          status: 'SENT',
          sentAt: expect.any(Date),
        }),
      }),
    );
  });

  it('enqueues a QUEUED row through the passed transaction client', async () => {
    await service.enqueue(txLike(), {
      userId: 'u-1',
      channel: 'EMAIL',
      templateCode: 'invoice_issued',
      payload: { message: 'hi', email: 'a@b.c' },
    });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ channel: 'EMAIL', status: 'QUEUED' }),
      }),
    );
  });

  it('delivers a queued EMAIL row through the mail port and marks it SENT', async () => {
    prisma.rows.push(queuedRow());
    await service.runOnce();
    expect(mail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'student@example.com', templateCode: 'tuition_due' }),
    );
    const row = firstRow();
    expect(row.status).toBe('SENT');
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(row.error).toBeNull();
    expect((row.payload as { deliveredVia?: string }).deliveredVia).toBe('EMAIL');
  });

  it('falls back ZNS -> SMS -> EMAIL when channels are unconfigured', async () => {
    prisma.rows.push(queuedRow({ channel: 'ZNS' }));
    await service.runOnce();
    expect(zns).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledTimes(1);
    expect(firstRow().status).toBe('SENT');
    expect((firstRow().payload as { deliveredVia?: string }).deliveredVia).toBe('EMAIL');
  });

  it('records a transient failure with backoff and returns the row to QUEUED', async () => {
    mail.mockRejectedValueOnce(new Error('smtp down'));
    prisma.rows.push(queuedRow());
    await service.runOnce();
    const row = firstRow();
    expect(row.status).toBe('QUEUED');
    expect(row.retries).toBe(1);
    expect(row.error).toBe('Notification delivery failed');
    expect(row.nextAttemptAt).toBeInstanceOf(Date);
  });

  it('marks a row FAILED once retries are exhausted', async () => {
    mail.mockRejectedValue(new Error('smtp down'));
    prisma.rows.push(queuedRow({ retries: 4 }));
    await service.runOnce();
    const row = firstRow();
    expect(row.status).toBe('FAILED');
    expect(row.retries).toBe(5);
    expect(row.nextAttemptAt).toBeNull();
  });

  it('queues a failure (with backoff) when the recipient is missing', async () => {
    prisma.rows.push(queuedRow({ payload: { message: 'no recipient' } }));
    await service.runOnce();
    const row = firstRow();
    expect(row.status).toBe('QUEUED');
    expect(row.retries).toBe(1);
    expect(row.error).toBe('Notification delivery failed');
  });

  it('requeues stale SENDING rows before claiming (crashed pass recovery)', async () => {
    prisma.rows.push(
      queuedRow({ status: 'SENDING', createdAt: new Date(Date.now() - 11 * 60_000) }),
    );
    await service.runOnce();
    expect(firstRow().status).toBe('SENT');
    expect(mail).toHaveBeenCalledTimes(1);
  });

  it('counts a failure when the whole chain is unconfigured so the retry cap still applies', async () => {
    prisma.rows.push(queuedRow({ channel: 'ZNS' }));
    mail.mockRejectedValue(new UnconfiguredChannelError('ZNS'));
    await service.runOnce();
    const row = firstRow();
    expect(row.status).toBe('QUEUED');
    expect(row.retries).toBe(1);
    expect(row.error).toBe('No delivery channel configured');
  });

  it('does not recover an old message whose worker lease is still fresh', async () => {
    prisma.rows.push(
      queuedRow({
        status: 'SENDING',
        createdAt: new Date(Date.now() - 60 * 60_000),
        claimedAt: new Date(),
      }),
    );
    await service.runOnce();
    expect(firstRow().status).toBe('SENDING');
    expect(mail).not.toHaveBeenCalled();
  });

  it('does not claim a message before its retry deadline', async () => {
    prisma.rows.push(queuedRow({ nextAttemptAt: new Date(Date.now() + 60_000) }));
    await service.runOnce();
    expect(firstRow().status).toBe('QUEUED');
    expect(mail).not.toHaveBeenCalled();
  });

  it('waits for the active send on shutdown and starts no new work', async () => {
    let finish: (() => void) | undefined;
    let started: (() => void) | undefined;
    const sendStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    mail.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
          started?.();
        }),
    );
    prisma.rows.push(queuedRow());
    const pass = service.runOnce();
    await sendStarted;
    let closed = false;
    const close = service.onModuleDestroy().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish?.();
    await Promise.all([pass, close]);
    expect(firstRow().status).toBe('SENT');
    await service.runOnce();
    expect(mail).toHaveBeenCalledTimes(1);
  });
});
