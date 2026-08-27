import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from 'src/database/database.service';
import { GoogleLoginDto } from './auth.dtos';
import { logininfoDTO } from './auth.dtos';
import { InfymeetUser, UsersRepository } from './users.repository';
import { describePasswordProblems } from './password.policy';
import { maskMobile, PasswordResetService } from './password-reset.service';
import { HelperService } from 'src/helper/helper.service';
import { buildOtpSms, OTP_TEMPLATE_ID } from 'src/helper/sms-templates';
import {
  Channel,
  ContactVerificationService,
  maskEmail,
} from './contact-verification.service';
import { emailProblem, mobileProblem, toDialable } from './contact.policy';

/** Handlebars source for the verification email. `code` is the only variable. */
const OTP_EMAIL_TEMPLATE = `
<div style="font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;padding:32px">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e2e8f0">
    <h1 style="margin:0 0 8px;font-size:20px;color:#0f172a">Verify your email</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#475569;line-height:1.6">
      Use this code to finish creating your InfyComm account. It expires in 10 minutes.
    </p>
    <div style="text-align:center;background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:18px;margin-bottom:24px">
      <span style="font-size:32px;font-weight:700;letter-spacing:10px;color:#4338ca">{{code}}</span>
    </div>
    <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
      If you did not request this, you can safely ignore this email — no account will be created.
    </p>
  </div>
</div>
`;

export type GoogleUserProfile = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
  /** dbo.infymeet_users.UserID, filled in once the account is persisted. */
  userId?: number;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
    private readonly users: UsersRepository,
    private readonly resets: PasswordResetService,
    private readonly helper: HelperService,
    private readonly contacts: ContactVerificationService,
  ) {}

  /** Sign the token every authenticated surface reads, including the meeting. */
  private signUserToken(user: InfymeetUser): string {
    const pub = this.users.toPublic(user);
    return this.jwt.sign({
      sub: String(pub.userId),
      userId: pub.userId,
      email: pub.email,
      name: pub.fullName,
      role: pub.role,
      provider: pub.authProvider,
    });
  }

  /** True for localhost / 127.0.0.1 / private-LAN origins. */
  private isLocalOrigin(origin: string): boolean {
    try {
      const { hostname } = new URL(origin);
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
      return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
    } catch {
      return false;
    }
  }

  /**
   * The callback URL handed to Google.
   *
   * In development it is derived from the origin the browser actually reached
   * this API on, so it always points somewhere that can answer — whether the
   * server is running http or https, on localhost or a LAN address. Pinning it
   * to a single env value is how it ends up naming a protocol the server does
   * not serve, which fails silently after the consent screen.
   *
   * A configured GOOGLE_CALLBACK_URL still wins for any non-local origin, so
   * production keeps its one fixed, registered URL.
   */
  getRedirectUri(requestOrigin?: string): string {
    const explicit = this.config.get<string>('GOOGLE_CALLBACK_URL')?.trim();

    if (requestOrigin && this.isLocalOrigin(requestOrigin)) {
      return `${requestOrigin.replace(/\/$/, '')}/auth/google/callback`;
    }

    if (explicit) return explicit.replace(/\/$/, '');

    const apiBase = (
      this.config.get<string>('API_PUBLIC_URL') ||
      `http://localhost:${this.config.get('PORT') || 5083}`
    ).replace(/\/$/, '');

    return `${apiBase}/auth/google/callback`;
  }

  getGoogleAuthUrl(next?: string, requestOrigin?: string): string {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.getRedirectUri(requestOrigin);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    });

    // Google requires the redirect_uri on the token exchange to be byte-identical
    // to the one on the auth request, so the exact string travels in `state`
    // rather than being derived a second time and risking a mismatch.
    params.set('state', this.encodeOAuthState(next, redirectUri));

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Pack the post-login destination into the OAuth `state` parameter.
   *
   * Only same-site paths are carried, so a crafted `next` cannot turn the
   * callback into an open redirect to another host.
   */
  private encodeOAuthState(next: string | undefined, redirectUri: string): string {
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '';
    return Buffer.from(JSON.stringify({ n: safeNext, r: redirectUri }), 'utf8')
      .toString('base64url');
  }

  /**
   * Unpack the state Google handed back.
   *
   * Tolerates the older plain-path format so a sign-in already in flight when
   * this deployed still completes instead of dead-ending.
   */
  decodeOAuthState(state?: string): { next: string; redirectUri: string } {
    if (!state) return { next: '', redirectUri: '' };
    try {
      const raw = Buffer.from(state, 'base64url').toString('utf8');

      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw) as { n?: string; r?: string };
        const next =
          parsed.n && parsed.n.startsWith('/') && !parsed.n.startsWith('//')
            ? parsed.n
            : '';
        return { next, redirectUri: parsed.r || '' };
      }

      const legacy = raw.startsWith('/') && !raw.startsWith('//') ? raw : '';
      return { next: legacy, redirectUri: '' };
    } catch {
      return { next: '', redirectUri: '' };
    }
  }

  getPublicGoogleConfig(requestOrigin?: string) {
    const apiBase = (
      requestOrigin ||
      this.config.get<string>('API_PUBLIC_URL') ||
      `http://localhost:${this.config.get('PORT') || 5083}`
    ).replace(/\/$/, '');

    return {
      clientId: this.config.get<string>('GOOGLE_CLIENT_ID') ?? '',
      googleAuthUrl: `${apiBase}/auth/google`,
      // The exact string that will be sent to Google from this origin. If sign-in
      // fails with redirect_uri_mismatch, this is the value to register.
      redirectUri: this.getRedirectUri(requestOrigin),
      allowedOrigins: (this.config.get<string>('ALLOWED_ORIGINS') ||
        'http://localhost:3000,https://meetings.infyshield.com')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      // What has to be registered in the Google Cloud console. The local dev
      // servers both run over https (next dev --experimental-https, and the API
      // loads local certs), so these are https — registering the http variants
      // is what makes the callback dead-end after the consent screen.
      // Register every one of these so sign-in keeps working whichever way the
      // servers happen to be started. Google matches redirect URIs literally —
      // http and https on the same port are two different entries.
      googleConsoleRedirectUris: Array.from(
        new Set([
          this.getRedirectUri(requestOrigin),
          'http://localhost:5083/auth/google/callback',
          'https://localhost:5083/auth/google/callback',
          'https://infyvideocallapi.infyshield.com/auth/google/callback',
        ]),
      ),
      googleConsoleJavascriptOrigins: [
        'http://localhost:3000',
        'https://localhost:3000',
        'https://meetings.infyshield.com',
      ],
    };
  }

  async loginWithGoogleCode(code: string, redirectUri?: string): Promise<{
    access_token: string;
    user: GoogleUserProfile;
    record: InfymeetUser;
  }> {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET');
    // Whatever was sent on the auth request, echoed back through state.
    const exchangeRedirectUri = redirectUri || this.getRedirectUri();

    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: exchangeRedirectUri,
      grant_type: 'authorization_code',
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new UnauthorizedException(`Google token exchange failed: ${errText}`);
    }

    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) {
      throw new UnauthorizedException('Google did not return an access token');
    }

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileRes.ok) {
      throw new UnauthorizedException('Failed to fetch Google user profile');
    }

    const profile = (await profileRes.json()) as {
      id: string;
      email?: string;
      name?: string;
      picture?: string;
    };

    const user: GoogleUserProfile = {
      sub: profile.id,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    };

    // Persist before issuing the token. Everyone who signs in with Google ends
    // up as a row in infymeet_users, which is what makes a meeting participant
    // identifiable later — previously this minted a JWT and stored nothing.
    const record = await this.users.upsertGoogleUser({
      googleId: profile.id,
      email: profile.email ?? null,
      fullName: profile.name ?? null,
    });

    if (!record) {
      throw new UnauthorizedException('Could not create your InfyMeet account');
    }

    user.userId = Number(record.UserID);

    return { access_token: this.signUserToken(record), user, record };
  }

  /** Email + password sign-in against infymeet_users. */
  async loginWithPassword(email: string, password: string) {
    const record = await this.users.verifyLocalLogin(email.trim(), password);
    if (!record) return null;
    return { access_token: this.signUserToken(record), record };
  }

  /** Resolve a bearer token back to the live row, so a disabled user is rejected. */
  async resolveToken(token: string) {
    let payload: Record<string, any>;
    try {
      payload = this.jwt.verify(token);
    } catch {
      return null;
    }

    const userId = Number(payload.userId ?? payload.sub);
    if (!Number.isFinite(userId)) return null;

    const record = await this.users.findById(userId);
    if (!record || record.IsActive === false) return null;
    return record;
  }

  /**
   * Register (or link) an account and hand back a usable session.
   *
   * Writes straight to dbo.infymeet_users rather than through sp_infymeet
   * Type 9, so the columns it touches are visible right here and match the
   * table definition exactly.
   */
  async createAccount(dto: GoogleLoginDto) {
    const email = (dto.email ?? '').trim();
    const fullName = (dto.fullName ?? '').trim();

    if (!email) {
      return { isSuccess: false, message: 'Email is required.', data: null };
    }

    try {
      if (dto.googleId) {
        const record = await this.users.upsertGoogleUser({
          googleId: dto.googleId,
          email,
          fullName,
        });
        if (!record) {
          return { isSuccess: false, message: 'Could not link that Google account.', data: null };
        }
        return {
          isSuccess: true,
          message: 'Google account linked',
          data: { ...this.users.toPublic(record), accessToken: this.signUserToken(record) },
        };
      }

      if (!dto.password) {
        return { isSuccess: false, message: 'Password is required.', data: null };
      }

      const weak = describePasswordProblems(dto.password);
      if (weak) {
        return { isSuccess: false, message: weak, data: null };
      }

      const badEmail = emailProblem(email);
      if (badEmail) return { isSuccess: false, message: badEmail, data: null };

      const badMobile = mobileProblem(dto.mobile ?? '');
      if (badMobile) return { isSuccess: false, message: badMobile, data: null };

      // Both contacts must be proven. The form enforces this too, but the
      // endpoint is reachable without it.
      if (!this.contacts.isVerified('email', email)) {
        return {
          isSuccess: false,
          message: 'Please verify your email address before creating the account.',
          data: null,
        };
      }
      if (!this.contacts.isVerified('mobile', dto.mobile ?? '')) {
        return {
          isSuccess: false,
          message: 'Please verify your mobile number before creating the account.',
          data: null,
        };
      }

      const conflicts = await this.users.findConflicts(email, dto.mobile ?? '');
      if (conflicts.emailTaken || conflicts.mobileTaken) {
        return {
          isSuccess: false,
          message: conflicts.emailTaken
            ? 'An account already exists for that email. Try logging in instead.'
            : 'That mobile number is already registered to another account.',
          data: null,
        };
      }

      const record = await this.users.createLocalUser({
        fullName,
        email,
        mobile: dto.mobile || null,
        password: dto.password,
      });

      if (!record) {
        return {
          isSuccess: false,
          message: 'An account already exists for that email. Try logging in instead.',
          data: null,
        };
      }

      // Both proofs are spent now that they have produced an account.
      this.contacts.consume(email, dto.mobile ?? '');

      return {
        isSuccess: true,
        message: 'Account created successfully',
        data: { ...this.users.toPublic(record), accessToken: this.signUserToken(record) },
      };
    } catch (err) {
      this.logger.error('Failed to create account', err);
      return { isSuccess: false, message: 'Could not create your account.', data: null };
    }
  }

  /** @deprecated use createAccount */
  async googleLogin(
    fullName: string,
    email: string,
    googleId: string,
    mobile?: string,
  ) {
    return this.createAccount({ fullName, email, googleId, mobile });
  }

  publicUser(record: InfymeetUser) {
    return this.users.toPublic(record);
  }

  /**
   * Attach a verified mobile to the signed-in account.
   *
   * This is the second half of a Google sign-up: Google gives us a name and an
   * email, and this fills in the one detail it cannot. The OTP behind it is
   * checked by the controller before we get here.
   */
  async completeProfile(userId: number, mobile: string) {
    const record = await this.users.setVerifiedMobile(userId, mobile);
    if (!record) return null;
    return { access_token: this.signUserToken(record), record };
  }

  // ── Signup contact verification ─────────────────────────────────────

  /** Is this email or mobile already spoken for? */
  async checkAvailability(email: string, mobile: string) {
    const conflicts = await this.users.findConflicts(email, mobile);
    return {
      isSuccess: !conflicts.emailTaken && !conflicts.mobileTaken,
      message: conflicts.emailTaken && conflicts.mobileTaken
        ? 'That email and mobile number are both already registered.'
        : conflicts.emailTaken
          ? 'That email is already registered. Try logging in instead.'
          : conflicts.mobileTaken
            ? 'That mobile number is already registered to another account.'
            : 'Available',
      data: conflicts,
    };
  }

  /**
   * Send a signup verification code down one channel.
   *
   * The contact is checked for availability first: there is no point proving
   * you own an address that cannot be registered anyway, and it saves sending
   * an SMS that leads nowhere.
   */
  async sendContactCode(channel: Channel, email: string, mobile: string) {
    const value = channel === 'email' ? email : mobile;

    const problem =
      channel === 'email' ? emailProblem(email) : mobileProblem(mobile);
    if (problem) return { isSuccess: false, message: problem, data: null };

    const conflicts = await this.users.findConflicts(
      channel === 'email' ? email : '',
      channel === 'mobile' ? mobile : '',
    );
    if (channel === 'email' && conflicts.emailTaken) {
      return {
        isSuccess: false,
        message: 'That email is already registered. Try logging in instead.',
        data: null,
      };
    }
    if (channel === 'mobile' && conflicts.mobileTaken) {
      return {
        isSuccess: false,
        message: 'That mobile number is already registered to another account.',
        data: null,
      };
    }

    const gate = this.contacts.gate(channel, value);
    if (!gate.ok) {
      return {
        isSuccess: false,
        message: `A code was just sent. Please wait ${gate.retryAfter}s.`,
        data: { retryAfter: gate.retryAfter },
      };
    }

    const code = this.contacts.issue(channel, value);

    try {
      if (channel === 'mobile') {
        const sent = await this.helper.sendSmsChecked(
          toDialable(mobile),
          buildOtpSms(code),
          OTP_TEMPLATE_ID,
        );
        if (!sent.ok) {
          this.logger.error(`Signup SMS not accepted by gateway: ${sent.detail}`);
          return {
            isSuccess: false,
            message: 'We could not text that number right now. Please try again shortly.',
            data: null,
          };
        }
      } else {
        const result = await this.helper.sendEmail(
          OTP_EMAIL_TEMPLATE,
          { code },
          email.trim(),
          'Your InfyComm verification code',
        );
        if (result !== 'Email sent successfully') {
          this.logger.error(`Verification email failed: ${JSON.stringify(result)}`);
          return {
            isSuccess: false,
            message: 'We could not email that address right now. Please try again shortly.',
            data: null,
          };
        }
      }
    } catch (err) {
      this.logger.error(`Could not send the ${channel} verification code`, err);
      return {
        isSuccess: false,
        message: 'We could not send the code right now. Please try again shortly.',
        data: null,
      };
    }

    return {
      isSuccess: true,
      message:
        channel === 'email'
          ? `We emailed a 6-digit code to ${maskEmail(email)}.`
          : 'We texted a 6-digit code to your mobile.',
      data: { channel },
    };
  }

  /** Check one channel's code and remember that the contact is proven. */
  verifyContactCode(channel: Channel, email: string, mobile: string, code: string) {
    const value = channel === 'email' ? email : mobile;
    const result = this.contacts.check(channel, value, code);

    if (result.ok) {
      return { isSuccess: true, message: 'Verified', data: { channel } };
    }

    const message =
      result.reason === 'expired'
        ? 'That code has expired. Please request a new one.'
        : result.reason === 'locked'
          ? 'Too many incorrect attempts. Please request a new code.'
          : result.reason === 'missing'
            ? 'No code is pending for that contact. Please request one.'
            : 'That code is not correct.';

    return { isSuccess: false, message, data: { channel } };
  }

  // ── Password reset ──────────────────────────────────────────────────

  /**
   * Start a reset: mint a code and text it to the number already on the account.
   *
   * The caller never gets to choose the destination — it is whatever Mobile the
   * account was registered with — so a reset cannot be redirected to an
   * attacker's phone by tampering with the request.
   */
  async requestPasswordReset(email: string): Promise<{
    isSuccess: boolean;
    message: string;
    data: { maskedMobile?: string; retryAfter?: number } | null;
  }> {
    const clean = email.trim();
    if (!clean) {
      return { isSuccess: false, message: 'Please enter your email address.', data: null };
    }

    const target = await this.users.findResetTarget(clean);

    if (!target || !target.isActive) {
      return {
        isSuccess: false,
        message: 'We could not find an active account for that email address.',
        data: null,
      };
    }

    if (!target.hasPassword) {
      return {
        isSuccess: false,
        message:
          'That account signs in with Google, so it has no password to reset. Use "Continue with Google" on the login page.',
        data: null,
      };
    }

    if (!target.mobile) {
      return {
        isSuccess: false,
        message:
          'That account has no mobile number on file, so we cannot text you a code. Please contact your administrator.',
        data: null,
      };
    }

    const wait = this.resets.cooldownRemaining(clean);
    if (wait > 0) {
      return {
        isSuccess: false,
        message: `A code was just sent. Please wait ${wait}s before requesting another.`,
        data: { retryAfter: wait },
      };
    }

    const code = this.resets.issue(clean, target.userId, target.mobile);

    try {
      // Must be the DLT-registered body, not custom wording: the operator drops
      // anything that does not match the template this id is registered under,
      // and the gateway still answers 200 — which is why a bespoke reset message
      // reported success and never reached the handset.
      const sent = await this.helper.sendSmsChecked(
        target.mobile,
        buildOtpSms(code),
        OTP_TEMPLATE_ID,
      );

      if (!sent.ok) {
        this.logger.error(`Reset SMS was not accepted by the gateway: ${sent.detail}`);
        return {
          isSuccess: false,
          message: 'We could not send the code right now. Please try again shortly.',
          data: null,
        };
      }
    } catch (err) {
      this.logger.error('Could not send the password reset SMS', err);
      return {
        isSuccess: false,
        message: 'We could not send the code right now. Please try again shortly.',
        data: null,
      };
    }

    return {
      isSuccess: true,
      message: `We sent a 6-digit code to ${maskMobile(target.mobile)}.`,
      data: { maskedMobile: maskMobile(target.mobile) },
    };
  }

  /** Finish a reset: check the code, enforce the policy, write the new password. */
  async resetPassword(email: string, code: string, newPassword: string) {
    const weak = describePasswordProblems(newPassword ?? '');
    if (weak) {
      return { isSuccess: false, message: weak, data: null };
    }

    const check = this.resets.verify(email, code);
    if (!check.ok) {
      const message =
        check.reason === 'expired'
          ? 'That code has expired. Please request a new one.'
          : check.reason === 'locked'
            ? 'Too many incorrect attempts. Please request a new code.'
            : check.reason === 'missing'
              ? 'No reset is in progress for that email. Please start again.'
              : 'That code is not correct.';
      return { isSuccess: false, message, data: null };
    }

    const record = await this.users.updatePassword(check.userId, newPassword);
    if (!record) {
      return { isSuccess: false, message: 'Could not update your password.', data: null };
    }

    // Sign them straight in — they have just proved both the email and the phone.
    return {
      isSuccess: true,
      message: 'Password updated',
      data: { ...this.users.toPublic(record), accessToken: this.signUserToken(record) },
    };
  }

  /** Mobile-OTP sign-in. The OTP itself is checked by the controller. */
  async loginWithMobile(mobile: string) {
    const record = await this.users.findByMobile(mobile.trim());
    if (!record || record.IsActive === false) return null;
    await this.users.touchLogin(Number(record.UserID));
    return { access_token: this.signUserToken(record), record };
  }

  async newprofileloginBoth(dto: logininfoDTO) {
    try {
      const result = await this.db.runStoredProcedure('sp_infymeet', {
        Type: 42,
        Mobile: dto.mobile,
        OTP: dto.otp,
      });
      return result?.recordsets?.[0] ?? [];
    } catch (err) {
      this.logger.error('newprofileloginBoth failed', err);
      throw err;
    }
  }

  async generateToken(payload: Record<string, any>): Promise<string> {
    return this.jwt.sign(payload);
  }

  async verifyToken(token: string): Promise<Record<string, any>> {
    return this.jwt.verify(token);
  }
}
