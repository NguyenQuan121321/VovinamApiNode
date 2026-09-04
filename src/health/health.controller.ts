import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: process is up; must not touch the database (plan 4.1). */
  @Get('healthz')
  getLiveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the database answers SELECT 1. */
  @Get('readyz')
  async getReadiness(): Promise<{ status: 'ok'; database: 'up' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Service unavailable');
    }
    return { status: 'ok', database: 'up' };
  }
}
