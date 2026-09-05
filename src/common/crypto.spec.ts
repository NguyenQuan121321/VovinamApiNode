import { constantTimeEquals } from './crypto';

describe('constantTimeEquals', () => {
  it('returns true only for equal inputs', () => {
    expect(constantTimeEquals('same', 'same')).toBe(true);
    expect(constantTimeEquals('same', 'other')).toBe(false);
  });

  it('handles different-length inputs without throwing', () => {
    expect(constantTimeEquals('a', 'aaaaaaaaaa')).toBe(false);
    expect(constantTimeEquals('', 'x')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
