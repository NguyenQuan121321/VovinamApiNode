import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthModule } from './health.module';
import type { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  const prisma = { $queryRaw: jest.fn() };
  const controller = new HealthController(prisma as unknown as PrismaService);

  it('healthz reports ok without touching the database', () => {
    expect(controller.getLiveness()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('readyz reports database up when SELECT 1 succeeds', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]);
    await expect(controller.getReadiness()).resolves.toEqual({ status: 'ok', database: 'up' });
  });

  it('readyz throws 503 when the database is unreachable', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    await expect(controller.getReadiness()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('health module stays loadable', () => {
    expect(new HealthModule()).toBeDefined();
  });
});
