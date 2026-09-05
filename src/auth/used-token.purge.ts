import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const PURGE_INTERVAL_MS = 6 * 3_600_000;
/** Rows outlive their token TTL so replays stay rejected; purge after a forensic window. */
const RETENTION_MS = 7 * 86_400_000;

/** Deletes consumed used_tokens rows past their retention window (plan 5.2 purge job). */
@Injectable()
export class UsedTokenPurgeJob implements OnModuleInit {
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.purgeOnce();
    this.timer = setInterval(() => void this.purgeOnce(), PURGE_INTERVAL_MS);
    this.timer.unref();
  }

  private async purgeOnce(): Promise<void> {
    try {
      await this.prisma.usedToken.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - RETENTION_MS) } },
      });
    } catch {
      // Purging is opportunistic; the next interval retries.
    }
  }
}
