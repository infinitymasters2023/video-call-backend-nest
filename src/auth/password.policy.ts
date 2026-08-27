/**
 * The single definition of what counts as an acceptable password.
 *
 * The signup form mirrors these rules to drive its live checklist, but this
 * copy is the one that decides — client-side validation is a convenience, not
 * a control, and the API is reachable without the form.
 */
export interface PasswordRule {
  id: string;
  label: string;
  test: (value: string) => boolean;
}

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_RULES: PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (v) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'upper', label: 'One uppercase letter (A–Z)', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'One lowercase letter (a–z)', test: (v) => /[a-z]/.test(v) },
  { id: 'digit', label: 'One number (0–9)', test: (v) => /[0-9]/.test(v) },
  {
    id: 'special',
    label: 'One special character (!@#$…)',
    test: (v) => /[^A-Za-z0-9]/.test(v),
  },
];

/** The ids of every rule the value fails. Empty means the password is good. */
export function failedPasswordRules(value: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(value)).map((r) => r.id);
}

export function isPasswordAcceptable(value: string): boolean {
  return failedPasswordRules(value).length === 0;
}

/** A single sentence naming what is still missing, for API error responses. */
export function describePasswordProblems(value: string): string | null {
  const missing = PASSWORD_RULES.filter((r) => !r.test(value));
  if (!missing.length) return null;
  // Only the first letter is lowered — lowercasing the whole label would turn
  // "(A–Z)" into "(a–z)" and make the two case rules read identically.
  const soften = (label: string) => label.charAt(0).toLowerCase() + label.slice(1);
  return `Password needs: ${missing.map((r) => soften(r.label)).join(', ')}.`;
}
