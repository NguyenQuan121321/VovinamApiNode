import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { trackerForIp } from './ip-tracker';

/**
 * Global per-IP throttler (plan 4.1): the tracker is the client IPv4 or the
 * IPv6 /64 prefix (S-10), taken from the trusted-proxy-resolved client address.
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as { ips?: string[]; ip?: string };
    return trackerForIp(request.ips?.[0] ?? request.ip ?? 'unknown');
  }
}
