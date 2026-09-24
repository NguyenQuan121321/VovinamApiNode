/**
 * Rate-limit tracker normalization (plan 4.1): attackers rotate IPv6 addresses
 * within one /64 for free, so all addresses sharing the first 64 bits collapse
 * into a single bucket (S-10). IPv4 (and IPv4-mapped IPv6) trackers stay exact.
 */
export function trackerForIp(ip: string): string {
  if (!ip.includes(':')) {
    return ip;
  }
  const clean = (ip.split('%')[0] ?? ip).toLowerCase();
  const v4mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(clean);
  const v4 = v4mapped?.[1];
  if (v4 !== undefined) {
    return v4;
  }
  const [head, tail] = clean.split('::') as [string, string | undefined];
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = Math.max(8 - headGroups.length - tailGroups.length, 0);
  const groups = [...headGroups, ...Array<string>(missing).fill('0'), ...tailGroups];
  while (groups.length < 8) {
    groups.push('0');
  }
  return `v6-${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}`;
}

/**
 * Tracker for a request (audit I-4/P2-7): uses Express's proxy-resolved client
 * address — with `trust proxy = 1` this is the first address NOT trusted from
 * the socket side, i.e. the one the edge proxy appended. `req.ips[0]` must NOT
 * be used: behind an edge that APPENDS to X-Forwarded-For, a client-supplied
 * XFF prefix lands there and rotates the abuse bucket per request.
 *
 * Deployment requirement (docs/SECURITY.md): the edge proxy must overwrite or
 * strip client-supplied X-Forwarded-For; with a non-conforming proxy, drop
 * `trust proxy` to 0 so the socket address is used.
 */
export function trackerFromRequest(req: { ip?: string }): string {
  return trackerForIp(req.ip ?? 'unknown');
}
