/** Parses simple duration strings used by env config: "120s", "15m", "1h", "30d" or bare seconds. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd]?)$/.exec(value.trim());
  if (match === null) {
    throw new Error(`Invalid duration value: "${value}" (expected forms like 90s, 15m, 1h, 30d)`);
  }
  const amount = Number(match[1]);
  switch (match[2]) {
    case '':
    case 's':
      return amount;
    case 'm':
      return amount * 60;
    case 'h':
      return amount * 3600;
    case 'd':
      return amount * 86_400;
    default:
      throw new Error(`Invalid duration unit: "${match[2]}"`);
  }
}
