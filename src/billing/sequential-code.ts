/**
 * Next value for a sequential human code such as INV-2026-0007 or EXAM-2026-03.
 *
 * The suffix of every code carrying the prefix must be numeric for the max to
 * be computed correctly: legacy/manual codes like INV-2026-D002 parse to NaN
 * and would otherwise wedge the generator on 'NaN' forever (found by the
 * Bruno UAT run against the demo dataset, 2026-09-25).
 */
export function nextSequentialCode(prefix: string, codes: string[], padWidth: number): string {
  let max = 0;
  for (const code of codes) {
    if (!code.startsWith(prefix)) {
      continue;
    }
    const parsed = Number.parseInt(code.slice(prefix.length), 10);
    if (Number.isInteger(parsed) && parsed > max) {
      max = parsed;
    }
  }
  return `${prefix}${String(max + 1).padStart(padWidth, '0')}`;
}
