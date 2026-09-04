import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Length-independent constant-time string comparison. Hashing both sides first makes
 * timingSafeEqual usable on inputs of different lengths (raw comparison would throw).
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest();
  const digestB = createHash('sha256').update(b).digest();
  return timingSafeEqual(digestA, digestB);
}
