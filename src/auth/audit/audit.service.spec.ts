import { AuditService, type AuditEntry } from './audit.service';

type CreateManyArgs = { data: Array<Record<string, unknown>> };

describe('AuditService', () => {
  const createMany = jest.fn(async (_args?: CreateManyArgs): Promise<{ count: number }> => ({
    count: 1,
  }));
  const prisma = { auditLog: { createMany } };
  const service = new AuditService(prisma as never);

  beforeEach(() => {
    createMany.mockClear();
    createMany.mockImplementation(async (_args?: CreateManyArgs) => ({ count: 1 }));
  });

  it('buffers entries and flushes them in batches', async () => {
    for (let i = 0; i < 120; i += 1) {
      service.record({ event: 'login', success: true, userId: 'u-1', ip: '127.0.0.1' });
    }
    await service.flush();
    expect(createMany).toHaveBeenCalledTimes(3);
    expect(Array.isArray(createMany.mock.calls[0]?.[0]?.data)).toBe(true);
  });

  it('truncates details and retains a failed batch for the next flush', async () => {
    service.record({
      event: 'login_failed',
      success: false,
      detail: 'x'.repeat(900),
      userId: undefined,
    } satisfies AuditEntry);
    await service.flush();
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(String(createMany.mock.calls[0]?.[0]?.data[0]?.detail)).toHaveLength(500);

    createMany.mockRejectedValueOnce(new Error('db down'));
    service.record({ event: 'login', success: true });
    await service.flush();
    await service.flush();
    expect(createMany).toHaveBeenCalledTimes(3);
    expect(createMany.mock.calls[1]?.[0]?.data).toEqual(createMany.mock.calls[2]?.[0]?.data);
  });

  it('flushes on module destroy', async () => {
    service.record({ event: 'logout', success: true });
    await service.onModuleDestroy();
    expect(createMany).toHaveBeenCalled();
  });
});
