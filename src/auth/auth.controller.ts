import { Body, Controller, Get, Headers, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { GoogleLoginDto, LoginDto, logininfoDTO, SendOTPEmailMessageDto } from './auth.dtos';
import { HelperService } from 'src/helper/helper.service';
import { loginotpservice } from './otp.service';
interface ApiResponse {
  statusCode: number;
  isSuccess: boolean;
  message: string;
  data: any;
}
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private helperService: HelperService,
    private loginotpservice: loginotpservice,
  ) { }

  @Get('google/config')
  getGoogleConfig() {
    return this.authService.getPublicGoogleConfig();
  }

  @Get('google')
  googleAuth(@Query('next') next: string, @Res() res: Response) {
    // `next` rides along in OAuth state so a shared meeting link survives the
    // detour through Google and the user lands back where they started.
    return res.redirect(this.authService.getGoogleAuthUrl(next));
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const frontend = (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    const next = this.authService.decodeOAuthState(state);

    if (error || !code) {
      return res.redirect(`${frontend}/login/?error=google_auth_failed`);
    }

    try {
      const { access_token, user } = await this.authService.loginWithGoogleCode(code);
      const params = new URLSearchParams({ token: access_token });
      if (user.email) params.set('email', user.email);
      if (user.name) params.set('name', user.name);
      if (user.picture) params.set('picture', user.picture);
      if (user.userId) params.set('userId', String(user.userId));
      if (next) params.set('next', next);
      return res.redirect(`${frontend}/auth/google-success/?${params.toString()}`);
    } catch (err) {
      console.error('Google callback failed', err);
      return res.redirect(`${frontend}/login/?error=google_auth_failed`);
    }
  }

  /** Email + password sign-in against dbo.infymeet_users. */
  @Post('login')
  async login(@Body() dto: LoginDto): Promise<ApiResponse> {
    const result = await this.authService.loginWithPassword(dto.email ?? '', dto.password ?? '');

    if (!result) {
      return {
        statusCode: 401,
        isSuccess: false,
        message: 'That email and password do not match an account.',
        data: null,
      };
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'Logged in successfully',
      data: {
        ...this.authService.publicUser(result.record),
        accessToken: result.access_token,
      },
    };
  }

  /** Who the bearer token belongs to. The frontend guard calls this on load. */
  @Get('me')
  async me(@Headers('authorization') authorization?: string): Promise<ApiResponse> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const record = token ? await this.authService.resolveToken(token) : null;

    if (!record) {
      return {
        statusCode: 401,
        isSuccess: false,
        message: 'Not signed in',
        data: null,
      };
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'OK',
      data: this.authService.publicUser(record),
    };
  }
  /**
   * Register or link an account.
   *
   * Google sign-ups are trusted because the profile came from Google's token
   * exchange. Email/password sign-ups must present the OTP that was sent to
   * their mobile — the endpoint used to accept an `otp` field and never look
   * at it, which meant the verification step could simply be skipped.
   */
  @Post('google-login')
  async googleLogin(@Body() dto: GoogleLoginDto): Promise<ApiResponse> {
    if (!dto.googleId) {
      const gate = this.consumeSignupOtp(dto.mobile, dto.otp);
      if (gate) return gate;
    }

    const result = await this.authService.createAccount(dto);
    return {
      statusCode: result.isSuccess ? 200 : 400,
      isSuccess: result.isSuccess,
      message: result.message,
      data: result.data,
    };
  }

  /** Returns an error response when the OTP is missing, wrong or expired. */
  private consumeSignupOtp(mobile?: string, otp?: string): ApiResponse | null {
    const mobileKey = String(mobile ?? '').trim();
    const supplied = String(otp ?? '').trim();

    if (!mobileKey || !supplied) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'Please verify your mobile number with the OTP first.',
        data: null,
      };
    }

    const stored = this.loginotpservice.getStoredOtp(mobileKey);
    if (!stored) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'OTP not found or expired. Please request a new one.',
        data: null,
      };
    }

    if (new Date() > new Date(stored.expiresAt)) {
      this.loginotpservice.removeStoredOtp(mobileKey);
      return { statusCode: 400, isSuccess: false, message: 'OTP expired.', data: null };
    }

    if (supplied !== String(stored.otp)) {
      return { statusCode: 400, isSuccess: false, message: 'Invalid OTP.', data: null };
    }

    this.loginotpservice.removeStoredOtp(mobileKey);
    return null;
  }

  @Post('newsend-email-txtmsg')
  async sendEmailTxtnewMsg(@Body() sendEmailDto: SendOTPEmailMessageDto): Promise<ApiResponse> {
    const mobile = String(sendEmailDto.mobile ?? '').trim();
    const otp = await this.helperService.generateRandomNumber();
    const otpStr = otp.toString();
    const lastSixDigits = await this.helperService.getLastSixDigits(otpStr);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // Expires in 5 minutes
    console.log('value genrate ', otp)
    this.loginotpservice.storeOtp(mobile, otpStr, expiresAt);

    const message = `Welcome to Infinity, Your OTP to Login to Infinity TechCare Lounge is ${lastSixDigits}. For Help, Call Infinity 8447882424. 9AM-6PM Mon-Sat`;
    await this.helperService.sendSms(mobile, message, '1107162426891569578');

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'OTP sent successfully',
      data: null,
    };
  }
  @Post('newloginhotcustomerpboth')
  async newlog(@Body() newcustomerlogininfoDTO: logininfoDTO): Promise<ApiResponse> {
    try {
      const { otp, mobile } = newcustomerlogininfoDTO;
      const mobileKey = String(mobile ?? '').trim();

      const stored = this.loginotpservice.getStoredOtp(mobileKey);

      if (!stored) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'OTP not found or expired',
          data: null,
        };
      }

      const { otp: storedOtp, expiresAt } = stored;

      if (otp?.toString() !== storedOtp.toString()) {
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'Invalid OTP',
          data: null,
        };
      }

      // ✅ Check if OTP expired
      if (new Date() > new Date(expiresAt)) {
        this.loginotpservice.removeStoredOtp(mobileKey);
        return {
          statusCode: 400,
          isSuccess: false,
          message: 'OTP expired',
          data: null,
        };
      }

      this.loginotpservice.removeStoredOtp(mobileKey);

      // The OTP is good; now the mobile has to belong to a real account.
      // This path only signs existing users in — creating one here would need
      // an email, and the table's UNIQUE(Email) allows just a single NULL.
      const session = await this.authService.loginWithMobile(mobileKey);
      const mid: number = Math.floor(Math.random() * 900) + 100;

      if (!session) {
        return {
          statusCode: 200,
          isSuccess: false,
          message: 'That mobile number is not registered. Please sign up with Google first.',
          data: { mobile: mobileKey, mid },
        };
      }

      return {
        statusCode: 200,
        isSuccess: true,
        message: 'Logged in successfully',
        data: {
          ...this.authService.publicUser(session.record),
          mid,
          accessToken: session.access_token,
        },
      };
    } catch (error) {
      console.error('Error in login:', error);
      return {
        statusCode: 500,
        isSuccess: false,
        message: 'Internal server error',
        data: null,
      };
    }
  }
}
