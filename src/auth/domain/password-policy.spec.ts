import { validatePasswordPolicy } from './password-policy';

describe('validatePasswordPolicy', () => {
  it('accepts a strong password unrelated to identity', () => {
    expect(validatePasswordPolicy('Str0ngPass', ['user@example.com', 'user'])).toBe(true);
  });

  it('rejects short passwords and missing character classes', () => {
    expect(validatePasswordPolicy('Sh0rt', ['u'])).toBe(false);
    expect(validatePasswordPolicy('onlyletters', ['u'])).toBe(false);
    expect(validatePasswordPolicy('12345678', ['u'])).toBe(false);
  });

  it('rejects passwords containing the email or username', () => {
    expect(validatePasswordPolicy('Minh1234minh', ['minh@example.com', 'minh'])).toBe(false);
    expect(validatePasswordPolicy('xMinh1999x', ['@example.com', 'minh'])).toBe(false);
  });

  it('ignores identity hints shorter than 3 characters', () => {
    expect(validatePasswordPolicy('ab12ab12', ['ab'])).toBe(true);
  });
});
