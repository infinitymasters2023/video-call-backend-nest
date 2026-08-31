import { Injectable, Logger } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'crypto';

/**
 * Short-lived reset codes, kept deliberately separate from the signup OTP store.
 *
 * Sharing `loginotpservice` would key both flows on the mobile number alone,
 * which lets a code issued for one purpose be spent on the other. This store is
 * keyed by email, expires quickly, caps how many guesses a code will tolerate,
 * and throttles re-sends so a six-digit code cannot be brute-forced.
 */
interface ResetTicket {
  code: string;
  userId: number;
  mobile: string;
  expiresAt: number;
  attempts: number;
  issuedAt: number;
}

export type VerifyResult =
  | { ok: true; userId: number }
  | { ok: false; reason: 'missing' | 'expired' | 'locked' | 'mismatch' };

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly tickets = new Map<string, ResetTicket>();

  private key(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Seconds left on the re-send cooldown, or 0 when a new code may be sent. */
  cooldownRemaining(email: string): number {
    const existing = this.tickets.get(this.key(email));
    if (!existing) return 0;
    const elapsed = Date.now() - existing.issuedAt;
    if (elapsed >= RESEND_COOLDOWN_MS) return 0;
    return Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
  }

  /**
   * Mint a code for this account.
   *
   * Uses crypto.randomInt rather than Math.random: this code is the only thing
   * standing between a request and someone else's password.
   */
  issue(email: string, userId: number, mobile: string): string {
    this.prune();
    const code = String(randomInt(100000, 1000000));
    this.tickets.set(this.key(email), {
      code,
      userId,
      mobile,
      expiresAt: Date.now() + TTL_MS,
      attempts: 0,
      issuedAt: Date.now(),
    });
    return code;
  }

  verify(email: string, supplied: string): VerifyResult {
    const k = this.key(email);
    const ticket = this.tickets.get(k);

    if (!ticket) return { ok: false, reason: 'missing' };

    if (Date.now() > ticket.expiresAt) {
      this.tickets.delete(k);
      return { ok: false, reason: 'expired' };
    }

    if (ticket.attempts >= MAX_ATTEMPTS) {
      this.tickets.delete(k);
      return { ok: false, reason: 'locked' };
    }

    ticket.attempts += 1;

    const given = Buffer.from(String(supplied ?? '').trim());
    const expected = Buffer.from(ticket.code);
    const matches =
      given.length === expected.length && timingSafeEqual(given, expected);

    if (!matches) return { ok: false, reason: 'mismatch' };

    // Single use — consumed the moment it works.
    this.tickets.delete(k);
    return { ok: true, userId: ticket.userId };
  }

  /** Drop expired tickets so the map cannot grow without bound. */
  private prune(): void {
    const now = Date.now();
    for (const [k, t] of this.tickets) {
      if (now > t.expiresAt) this.tickets.delete(k);
    }
  }
}

/** `9876543210` → `••••••3210`, so the user knows which phone to check. */
export function maskMobile(mobile: string): string {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `${'•'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}
