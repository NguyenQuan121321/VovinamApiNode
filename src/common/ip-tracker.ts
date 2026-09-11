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
