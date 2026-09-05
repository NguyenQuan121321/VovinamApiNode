import { parseDurationSeconds } from './duration';

describe('parseDurationSeconds', () => {
  it('parses all supported units', () => {
    expect(parseDurationSeconds('90s')).toBe(90);
    expect(parseDurationSeconds('15m')).toBe(900);
    expect(parseDurationSeconds('1h')).toBe(3600);
    expect(parseDurationSeconds('30d')).toBe(2_592_000);
    expect(parseDurationSeconds('45')).toBe(45);
  });

  it('rejects malformed values', () => {
    expect(() => parseDurationSeconds('15min')).toThrow(/Invalid duration/);
    expect(() => parseDurationSeconds('')).toThrow(/Invalid duration/);
    expect(() => parseDurationSeconds('-5m')).toThrow(/Invalid duration/);
  });
});
