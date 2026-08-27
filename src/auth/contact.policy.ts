/**
 * Server-side email and phone rules.
 *
 * The signup form mirrors these in `service/contact-validation.ts` to drive its
 * live red/green feedback, but this copy is the one that decides — the API is
 * reachable without the form.
 */

export interface CountryRule {
  iso: string;
  name: string;
  dial: string;
  lengths: number[];
}

export const COUNTRY_RULES: CountryRule[] = [
  { iso: 'IN', name: 'India', dial: '91', lengths: [10] },
  { iso: 'US', name: 'United States', dial: '1', lengths: [10] },
  { iso: 'GB', name: 'United Kingdom', dial: '44', lengths: [10] },
  { iso: 'AE', name: 'United Arab Emirates', dial: '971', lengths: [9] },
  { iso: 'SG', name: 'Singapore', dial: '65', lengths: [8] },
  { iso: 'AU', name: 'Australia', dial: '61', lengths: [9] },
  { iso: 'CA', name: 'Canada', dial: '1', lengths: [10] },
  { iso: 'DE', name: 'Germany', dial: '49', lengths: [10, 11] },
  { iso: 'FR', name: 'France', dial: '33', lengths: [9] },
  { iso: 'NP', name: 'Nepal', dial: '977', lengths: [10] },
  { iso: 'LK', name: 'Sri Lanka', dial: '94', lengths: [9] },
  { iso: 'BD', name: 'Bangladesh', dial: '880', lengths: [10] },
  { iso: 'MY', name: 'Malaysia', dial: '60', lengths: [9, 10] },
  { iso: 'SA', name: 'Saudi Arabia', dial: '966', lengths: [9] },
  { iso: 'ZA', name: 'South Africa', dial: '27', lengths: [9] },
];

const EMAIL_RE =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

export function emailProblem(value: string): string | null {
  const v = String(value ?? '').trim();
  if (!v) return 'Email is required.';
  if (/\s/.test(v)) return 'An email address cannot contain spaces.';
  if (v.split('@').length !== 2) return 'That does not look like a valid email address.';
  if (v.includes('..')) return 'An email address cannot contain two dots in a row.';
  if (v.length > 200) return 'That email address is too long.';
  if (!EMAIL_RE.test(v)) return 'That does not look like a valid email address.';
  return null;
}

export function digitsOnly(value: string): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Split full international digits back into a country and a national number.
 *
 * Longer dial codes are tried first so `977…` reads as Nepal rather than as a
 * US number that happens to start with 9.
 */
export function splitInternational(
  international: string,
): { country: CountryRule; national: string } | null {
  const digits = digitsOnly(international);
  const byLongestDial = [...COUNTRY_RULES].sort(
    (a, b) => b.dial.length - a.dial.length,
  );

  for (const country of byLongestDial) {
    if (!digits.startsWith(country.dial)) continue;
    const national = digits.slice(country.dial.length);
    if (country.lengths.includes(national.length)) return { country, national };
  }
  return null;
}

/**
 * Validate a mobile given as full international digits (e.g. `919876543210`).
 *
 * A bare national number is still accepted and read as India, because that is
 * what every row written before the country selector existed looks like.
 */
export function mobileProblem(international: string): string | null {
  const digits = digitsOnly(international);
  if (!digits) return 'Mobile number is required.';

  const split = splitInternational(digits);

  if (!split) {
    if (digits.length === 10) {
      return /^[6-9]/.test(digits)
        ? null
        : 'An Indian mobile number starts with 6, 7, 8 or 9.';
    }
    return 'That mobile number does not match any supported country code.';
  }

  if (split.country.iso === 'IN' && !/^[6-9]/.test(split.national)) {
    return 'An Indian mobile number starts with 6, 7, 8 or 9.';
  }
  if (/^(\d)\1+$/.test(split.national)) {
    return 'That does not look like a real number.';
  }
  return null;
}

/**
 * The last ten digits, which is how a mobile is matched everywhere.
 *
 * Rows written before the country selector hold a bare national number, and the
 * OTP store already keys on the last ten, so comparing on that keeps both the
 * old and new formats resolving to the same account.
 */
export function mobileKey(value: string): string {
  return digitsOnly(value).slice(-10);
}

/** The number to hand the SMS gateway. */
export function toDialable(international: string): string {
  const digits = digitsOnly(international);
  const split = splitInternational(digits);
  // The gateway is Indian and takes bare national numbers for +91, which is
  // what every message sent so far has used. Everything else goes fully
  // qualified.
  if (!split) return digits;
  return split.country.iso === 'IN' ? split.national : digits;
}
