import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { trackerFromRequest } from './ip-tracker';

/**
 * Global per-IP throttler (plan 4.1): the tracker is the proxy-resolved client
 * IPv4 or the IPv6 /64 prefix (S-10). The tracker comes from `request.ip` — the
 * first untrusted address from the socket side — never from `request.ips[0]`,
 * which a client can rotate via a spoofed XFF prefix behind an appending edge
 * (audit I-4/P2-7).
 */
@Injectable()
export class IpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    return trackerFromRequest(req as { ip?: string });
  }
}
