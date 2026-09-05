import { formatHhMm, parseHhMm } from './time';

describe('time-of-day helpers (Postgres TIME round trip)', () => {
  it('parses HH:mm onto the 1970-01-01 epoch in UTC', () => {
    expect(parseHhMm('18:30').toISOString()).toBe('1970-01-01T18:30:00.000Z');
    expect(parseHhMm('00:00').toISOString()).toBe('1970-01-01T00:00:00.000Z');
    expect(parseHhMm('23:59').toISOString()).toBe('1970-01-01T23:59:00.000Z');
  });

  it('rejects malformed times of day', () => {
    expect(() => parseHhMm('24:00')).toThrow();
    expect(() => parseHhMm('7:30')).toThrow();
    expect(() => parseHhMm('18:5')).toThrow();
    expect(() => parseHhMm('18:60')).toThrow();
    expect(() => parseHhMm('')).toThrow();
  });

  it('formats using UTC parts so server timezone cannot shift the schedule', () => {
    expect(formatHhMm(parseHhMm('09:05'))).toBe('09:05');
    expect(formatHhMm(new Date('2026-09-06T18:00:00.000Z'))).toBe('18:00');
  });
});
