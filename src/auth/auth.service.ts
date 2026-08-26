import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DatabaseService } from 'src/database/database.service';
import { GoogleLoginDto } from './auth.dtos';
import { logininfoDTO } from './auth.dtos';
import { InfymeetUser, UsersRepository } from './users.repository';

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

  private getRedirectUri(): string {
    const explicit = this.config.get<string>('GOOGLE_CALLBACK_URL')?.trim();
    if (explicit) return explicit.replace(/\/$/, '');

    const apiBase = (
      this.config.get<string>('API_PUBLIC_URL') ||
      `http://localhost:${this.config.get('PORT') || 5083}`
    ).replace(/\/$/, '');

    return `${apiBase}/auth/google/callback`;
  }

  getGoogleAuthUrl(next?: string): string {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const redirectUri = this.getRedirectUri();

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
    });

    const state = this.encodeOAuthState(next);
    if (state) params.set('state', state);

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Pack the post-login destination into the OAuth `state` parameter.
   *
   * Only same-site paths are carried, so a crafted `next` cannot turn the
   * callback into an open redirect to another host.
   */
  private encodeOAuthState(next?: string): string {
    if (!next) return '';
    if (!next.startsWith('/') || next.startsWith('//')) return '';
    return Buffer.from(next, 'utf8').toString('base64url');
  }

  decodeOAuthState(state?: string): string {
    if (!state) return '';
    try {
      const next = Buffer.from(state, 'base64url').toString('utf8');
      if (!next.startsWith('/') || next.startsWith('//')) return '';
      return next;
    } catch {
      return '';
    }
  }

  getPublicGoogleConfig() {
    const apiBase = (
      this.config.get<string>('API_PUBLIC_URL') ||
      `http://localhost:${this.config.get('PORT') || 5083}`
    ).replace(/\/$/, '');

    return {
      clientId: this.config.get<string>('GOOGLE_CLIENT_ID') ?? '',
      googleAuthUrl: `${apiBase}/auth/google`,
      redirectUri: this.getRedirectUri(),
      allowedOrigins: (this.config.get<string>('ALLOWED_ORIGINS') ||
        'http://localhost:3000,https://meetings.infyshield.com')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      googleConsoleRedirectUris: [
        `${apiBase}/auth/google/callback`,
        'http://localhost:5083/auth/google/callback',
      ],
      googleConsoleJavascriptOrigins: [
        'http://localhost:3000',
        'https://meetings.infyshield.com',
      ],
    };
  }

  async loginWithGoogleCode(code: string): Promise<{
    access_token: string;
    user: GoogleUserProfile;
    record: InfymeetUser;
  }> {
    const clientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.getOrThrow<string>('GOOGLE_CLIENT_SECRET');
    const redirectUri = this.getRedirectUri();

    const tokenBody = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
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
