/**
 * Postgres TIME round-trips through Prisma as a Date on the 1970-01-01 epoch in
 * UTC (verified against PostgreSQL 18), so time-of-day is converted to/from
 * "HH:mm" strings using the UTC accessors — never local time.
 */
export const HH_MM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function parseHhMm(value: string): Date {
  const match = HH_MM_PATTERN.exec(value);
  if (match === null) {
    throw new Error(`Invalid time of day: ${value}`);
  }
  const [hours, minutes] = value.split(':').map(Number) as [number, number];
  return new Date(Date.UTC(1970, 0, 1, hours, minutes));
}

export function formatHhMm(value: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}`;
}
