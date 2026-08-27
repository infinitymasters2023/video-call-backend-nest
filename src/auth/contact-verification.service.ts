import { Injectable, Logger } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'crypto';
import { mobileKey } from './contact.policy';

export type Channel = 'email' | 'mobile';

interface Pending {
  code: string;
  expiresAt: number;
  attempts: number;
  issuedAt: number;
}

export type SendGate = { ok: true } | { ok: false; retryAfter: number };

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'expired' | 'locked' | 'mismatch' };

const CODE_TTL_MS = 10 * 60 * 1000;
/** How long a verified contact stays good while the rest of the form is filled. */
const VERIFIED_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 45 * 1000;

/**
 * Holds the two independent proofs a signup needs: that the email is reachable
 * and that the mobile is. Both must be verified before an account is created.
 *
 * Separate from the login OTP store on purpose — a code minted to prove you own
 * an address should not also be spendable as a login, and vice versa.
 */
@Injectable()
export class ContactVerificationService {
  private readonly logger = new Logger(ContactVerificationService.name);
  private readonly pending = new Map<string, Pending>();
  private readonly verified = new Map<string, number>();

  /**
   * Canonical key for a contact.
   *
   * Emails are lowercased; mobiles collapse to their last ten digits, which is
   * what the OTP store and every existing row already key on, so the same phone
   * resolves the same way whether it arrives with a country code or without.
   */
  key(channel: Channel, value: string): string {
    const v = String(value ?? '').trim();
    return channel === 'email'
      ? `email:${v.toLowerCase()}`
      : `mobile:${mobileKey(v)}`;
  }

  /** Seconds to wait before another code may be sent, or 0. */
  cooldownRemaining(channel: Channel, value: string): number {
    const existing = this.pending.get(this.key(channel, value));
    if (!existing) return 0;
    const elapsed = Date.now() - existing.issuedAt;
    if (elapsed >= RESEND_COOLDOWN_MS) return 0;
    return Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
  }

  /** Check the throttle before doing the work of sending. */
  gate(channel: Channel, value: string): SendGate {
    const wait = this.cooldownRemaining(channel, value);
    return wait > 0 ? { ok: false, retryAfter: wait } : { ok: true };
  }

  issue(channel: Channel, value: string): string {
    this.prune();
    const code = String(randomInt(100000, 1000000));
    this.pending.set(this.key(channel, value), {
      code,
      expiresAt: Date.now() + CODE_TTL_MS,
      attempts: 0,
      issuedAt: Date.now(),
    });
    return code;
  }

  check(channel: Channel, value: string, supplied: string): CheckResult {
    const k = this.key(channel, value);
    const entry = this.pending.get(k);

    if (!entry) return { ok: false, reason: 'missing' };

    if (Date.now() > entry.expiresAt) {
      this.pending.delete(k);
      return { ok: false, reason: 'expired' };
    }
    if (entry.attempts >= MAX_ATTEMPTS) {
      this.pending.delete(k);
      return { ok: false, reason: 'locked' };
    }

    entry.attempts += 1;

    const given = Buffer.from(String(supplied ?? '').trim());
    const expected = Buffer.from(entry.code);
    const matches =
      given.length === expected.length && timingSafeEqual(given, expected);

    if (!matches) return { ok: false, reason: 'mismatch' };

    this.pending.delete(k);
    this.verified.set(k, Date.now() + VERIFIED_TTL_MS);
    return { ok: true };
  }

  isVerified(channel: Channel, value: string): boolean {
    const k = this.key(channel, value);
    const until = this.verified.get(k);
    if (!until) return false;
    if (Date.now() > until) {
      this.verified.delete(k);
      return false;
    }
    return true;
  }

  /** Spend both proofs once the account has actually been created. */
  consume(email: string, mobile: string): void {
    this.verified.delete(this.key('email', email));
    this.verified.delete(this.key('mobile', mobile));
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now > v.expiresAt) this.pending.delete(k);
    for (const [k, until] of this.verified) if (now > until) this.verified.delete(k);
  }
}

/** `parveen@gmail.com` → `par•••@gmail.com` */
export function maskEmail(email: string): string {
  const v = String(email ?? '').trim();
  const at = v.indexOf('@');
  if (at <= 0) return '•••';
  const local = v.slice(0, at);
  const domain = v.slice(at);
  if (local.length <= 3) return `${local[0] ?? ''}•••${domain}`;
  return `${local.slice(0, 3)}•••${domain}`;
}
