/**
 * Static password policy (plan 4.1): minimum 8 characters, letters and digits required,
 * and the password must not contain the account's email or username. zxcvbn/HIBP stays
 * out of scope by decision (plan 4.2).
 */
export function validatePasswordPolicy(password: string, identityHints: string[]): boolean {
  if (password.length < 8) {
    return false;
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return false;
  }
  const lowered = password.toLowerCase();
  return !identityHints.some((hint) => hint.length >= 3 && lowered.includes(hint.toLowerCase()));
}
