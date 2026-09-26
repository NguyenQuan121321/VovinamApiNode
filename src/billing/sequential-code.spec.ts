import { nextSequentialCode } from './sequential-code';

describe('nextSequentialCode', () => {
  it('starts at 1 when no codes exist', () => {
    expect(nextSequentialCode('INV-2026-', [], 4)).toBe('INV-2026-0001');
  });

  it('increments the numeric maximum', () => {
    expect(nextSequentialCode('INV-2026-', ['INV-2026-0001', 'INV-2026-0007'], 4)).toBe(
      'INV-2026-0008',
    );
  });

  it('ignores codes with non-numeric suffixes', () => {
    // INV-2026-D002 previously parsed to NaN and produced INV-2026-NaN forever.
    expect(nextSequentialCode('INV-2026-', ['INV-2026-D002'], 4)).toBe('INV-2026-0001');
    expect(
      nextSequentialCode('INV-2026-', ['INV-2026-D002', 'INV-2026-0012', 'INV-2026-X9'], 4),
    ).toBe('INV-2026-0013');
  });

  it('ignores codes with a different prefix', () => {
    expect(nextSequentialCode('EXAM-2026-', ['INV-2026-0042', 'EXAM-2025-01'], 2)).toBe(
      'EXAM-2026-01',
    );
  });

  it('keeps numbers wider than the pad width', () => {
    expect(nextSequentialCode('EXAM-2026-', ['EXAM-2026-99'], 2)).toBe('EXAM-2026-100');
  });

  it('ignores empty-suffix codes', () => {
    expect(nextSequentialCode('INV-', ['INV-'], 4)).toBe('INV-0001');
  });
});
