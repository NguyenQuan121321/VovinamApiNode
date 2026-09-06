import { trackerForIp } from './ip-tracker';

describe('trackerForIp (plan 4.1, S-10 semantics)', () => {
  it('keeps IPv4 trackers exact', () => {
    expect(trackerForIp('203.0.113.9')).toBe('203.0.113.9');
  });

  it('collapses IPv6 addresses sharing a /64 into one bucket', () => {
    const a = trackerForIp('2001:db8:1234:5678:9abc:def0:1234:5678');
    const b = trackerForIp('2001:DB8:1234:5678::dead');
    expect(a).toBe('v6-2001:0db8:1234:5678');
    expect(b).toBe(a);
  });

  it('expands compressed forms before bucketing', () => {
    expect(trackerForIp('::1')).toBe('v6-0000:0000:0000:0000');
    expect(trackerForIp('2001:db8::abcd')).toBe('v6-2001:0db8:0000:0000');
  });

  it('treats IPv4-mapped IPv6 as plain IPv4 so mapped clients stay distinct', () => {
    expect(trackerForIp('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('strips zone indices', () => {
    expect(trackerForIp('fe80::1%eth0')).toBe('v6-fe80:0000:0000:0000');
  });
});
