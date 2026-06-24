import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'crypto';
import { DatabaseService } from 'src/database/database.service';
import { GoogleLoginDto } from './auth.dtos';
import { logininfoDTO } from './auth.dtos';

export type GoogleUserProfile = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly db: DatabaseService,
  ) {}

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
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

  getGoogleAuthUrl(): string {
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

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
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

    const access_token = this.jwt.sign({
      sub: user.sub,
      email: user.email,
      name: user.name,
      picture: user.picture,
    });

    return { access_token, user };
  }

  async createAccount(dto: GoogleLoginDto) {
    try {
      const passwordHash = dto.password ? this.hashPassword(dto.password) : null;
      const authProvider = dto.googleId ? 'google' : 'local';

      const result = await this.db.runStoredProcedure('sp_infymeet', {
        Type: 9,
        FullName: dto.fullName ?? '',
        Email: dto.email ?? '',
        Mobile: dto.mobile || null,
        PasswordHash: passwordHash,
        AuthProvider: authProvider,
        GoogleID: dto.googleId || null,
      });

      return {
        status: true,
        data: result?.recordsets?.[0]?.[0] || null,
        message: authProvider === 'google' ? 'Google account linked' : 'Account created successfully',
      };
    } catch (err) {
      this.logger.error('Failed to create account', err);
      throw err;
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
