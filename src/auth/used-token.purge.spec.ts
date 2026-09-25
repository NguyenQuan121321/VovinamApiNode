import { UsedTokenPurgeJob } from './used-token.purge';
import { PrismaService } from '../prisma/prisma.service';

describe('UsedTokenPurgeJob', () => {
  it('purges consumed tokens past the retention window and survives failures', async () => {
    const prisma = { usedToken: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) } };
    const job = new UsedTokenPurgeJob(prisma as unknown as PrismaService);
    await job.onModuleInit();
    expect(prisma.usedToken.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { expiresAt: { lt: expect.any(Date) } } }),
    );

    // Purging is opportunistic: a database failure must not escape the interval.
    prisma.usedToken.deleteMany.mockRejectedValueOnce(new Error('db down'));
    await expect(job.onModuleInit()).resolves.toBeUndefined();
  });
});
