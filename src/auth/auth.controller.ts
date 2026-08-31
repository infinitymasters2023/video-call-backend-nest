import { Body, Controller, Get, Headers, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  AvailabilityDto,
  CompleteProfileDto,
  ContactCodeDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  LoginDto,
  logininfoDTO,
  ResetPasswordDto,
  SendOTPEmailMessageDto,
} from './auth.dtos';
import { HelperService } from 'src/helper/helper.service';
import { loginotpservice } from './otp.service';
import { SubscriptionService } from './subscription.service';
import { buildOtpSms, OTP_TEMPLATE_ID } from 'src/helper/sms-templates';
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
    private readonly subscriptions: SubscriptionService,
  ) { }

  /** The origin the browser actually reached this API on, e.g. https://localhost:5083 */
  private originOf(req: Request): string {
    const proto = req.secure ? 'https' : req.protocol || 'http';
    return `${proto}://${req.get('host')}`;
  }

  @Get('google/config')
  getGoogleConfig(@Req() req: Request) {
    return this.authService.getPublicGoogleConfig(this.originOf(req));
  }

  @Get('google')
  googleAuth(
    @Query('next') next: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // `next` rides along in OAuth state so a shared meeting link survives the
    // detour through Google and the user lands back where they started.
    return res.redirect(
      this.authService.getGoogleAuthUrl(next, this.originOf(req)),
    );
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const frontend = (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );
    const { next, redirectUri } = this.authService.decodeOAuthState(state);

    if (error || !code) {
      return res.redirect(`${frontend}/login/?error=google_auth_failed`);
    }

    try {
      const { access_token, user } = await this.authService.loginWithGoogleCode(
        code,
        redirectUri || `${this.originOf(req)}/auth/google/callback`,
      );
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

  /** Is this email / mobile free to register? Drives the form's live feedback. */
  @Post('check-availability')
  async checkAvailability(@Body() dto: AvailabilityDto): Promise<ApiResponse> {
    const result = await this.authService.checkAvailability(
      dto.email ?? '',
      dto.mobile ?? '',
    );
    return {
      statusCode: 200,
      isSuccess: result.isSuccess,
      message: result.message,
      data: result.data,
    };
  }

  /**
   * Send a signup verification code to one channel.
   *
   * Signup needs both an email and a mobile proven, so this is called once per
   * channel and each is verified independently.
   */
  @Post('signup/send-code')
  async sendContactCode(@Body() dto: ContactCodeDto): Promise<ApiResponse> {
    const channel = dto.channel === 'email' ? 'email' : 'mobile';
    const result = await this.authService.sendContactCode(
      channel,
      dto.email ?? '',
      dto.mobile ?? '',
    );
    return {
      statusCode: result.isSuccess ? 200 : 400,
      isSuccess: result.isSuccess,
      message: result.message,
      data: result.data,
    };
  }

  /** Check one channel's code and mark that contact proven. */
  @Post('signup/verify-code')
  verifyContactCode(@Body() dto: ContactCodeDto): ApiResponse {
    const channel = dto.channel === 'email' ? 'email' : 'mobile';
    const result = this.authService.verifyContactCode(
      channel,
      dto.email ?? '',
      dto.mobile ?? '',
      dto.code ?? '',
    );
    return {
      statusCode: result.isSuccess ? 200 : 400,
      isSuccess: result.isSuccess,
      message: result.message,
      data: result.data,
    };
  }

  /**
   * Step one of a password reset: text a code to the number on the account.
   *
   * The destination is never taken from the request — only the email is — so a
   * reset code always goes to the phone already registered for that account.
   */
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<ApiResponse> {
    const result = await this.authService.requestPasswordReset(dto.email ?? '');
    return {
      statusCode: result.isSuccess ? 200 : 400,
      isSuccess: result.isSuccess,
      message: result.message,
      data: result.data,
    };
  }

  /** Step two: verify the code and store the new password. */
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<ApiResponse> {
    const result = await this.authService.resetPassword(
      dto.email ?? '',
      dto.otp ?? '',
      dto.newPassword ?? '',
    );
    return {
      statusCode: result.isSuccess ? 200 : 400,
      isSuccess: result.isSuccess,
      message: result.message,
      data: result.data,
    };
  }

  /**
   * Finish a Google sign-up by attaching a verified mobile number.
   *
   * Google hands us a name and an email; this collects the one detail it cannot
   * and marks the account complete, so the same email walks straight in next
   * time. Requires the bearer token issued by the Google callback.
   */
  @Post('complete-profile')
  async completeProfile(
    @Body() dto: CompleteProfileDto,
    @Headers('authorization') authorization?: string,
  ): Promise<ApiResponse> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const record = token ? await this.authService.resolveToken(token) : null;

    if (!record) {
      return { statusCode: 401, isSuccess: false, message: 'Not signed in', data: null };
    }

    const mobile = String(dto.mobile ?? '').replace(/\D/g, '').slice(-10);
    if (mobile.length !== 10) {
      return {
        statusCode: 400,
        isSuccess: false,
        message: 'Please enter a valid 10-digit mobile number.',
        data: null,
      };
    }

    const gate = this.consumeSignupOtp(mobile, dto.otp);
    if (gate) return gate;

    const session = await this.authService.completeProfile(Number(record.UserID), mobile);
    if (!session) {
      return {
        statusCode: 500,
        isSuccess: false,
        message: 'Could not save your mobile number. Please try again.',
        data: null,
      };
    }

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'Profile completed',
      data: {
        ...this.authService.publicUser(session.record),
        accessToken: session.access_token,
      },
    };
  }

  /**
   * The signed-in user plus their plan and meeting quota.
   *
   * Backs the profile page. Usage counts are not live yet — the response says
   * so via `usage.usageTracked` so the page can be honest about it.
   */
  @Get('profile')
  async profile(@Headers('authorization') authorization?: string): Promise<ApiResponse> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const record = token ? await this.authService.resolveToken(token) : null;

    if (!record) {
      return { statusCode: 401, isSuccess: false, message: 'Not signed in', data: null };
    }

    const usage = await this.subscriptions.getUsage(Number(record.UserID));

    return {
      statusCode: 200,
      isSuccess: true,
      message: 'OK',
      data: {
        user: this.authService.publicUser(record),
        usage,
        plans: this.subscriptions.listPlans(),
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
    // The single mobile OTP that used to gate this is gone: createAccount now
    // requires BOTH the email and the mobile to have been separately verified
    // through /auth/signup/verify-code, which is a strictly stronger check.
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

    // Same wording as before, now from the shared builder so the body and the
    // DLT template id can never drift apart.
    await this.helperService.sendSms(
      mobile,
      buildOtpSms(lastSixDigits),
      OTP_TEMPLATE_ID,
    );

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
