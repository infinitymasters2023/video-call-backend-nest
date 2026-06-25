import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import {
  GoogleLoginDto,
  logininfoDTO,
  SendOTPEmailMessageDto,
} from './auth.dtos';
import { HelperService } from 'src/helper/helper.service';
import { loginotpservice } from './otp.service';

type ApiResponse<T = unknown> = {
  statusCode: number;
  isSuccess: boolean;
  message: string;
  data: T | null;
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
    private readonly helperService: HelperService,
    private readonly loginOtpService: loginotpservice,
  ) {}

  private getFrontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000'
    ).replace(/\/$/, '');
  }

  private normalizeMobile(mobile?: string): string {
    return String(mobile ?? '')
      .trim()
      .replace(/\D/g, '')
      .slice(-10);
  }

  private fail<T = null>(
    statusCode: number,
    message: string,
    data: T | null = null,
  ): ApiResponse<T> {
    return { statusCode, isSuccess: false, message, data };
  }

  private ok<T>(message: string, data: T): ApiResponse<T> {
    return { statusCode: 200, isSuccess: true, message, data };
  }

  private verifyStoredOtp(
    mobile: string | undefined,
    otp: string | undefined,
  ): ApiResponse | null {
    const mobileKey = this.normalizeMobile(mobile);
    const otpValue = String(otp ?? '').trim();

    if (!mobileKey || mobileKey.length < 10) {
      return this.fail(400, 'Valid 10-digit mobile number is required');
    }
    if (!otpValue) {
      return this.fail(400, 'OTP is required');
    }

    const stored = this.loginOtpService.getStoredOtp(mobileKey);
    if (!stored) {
      return this.fail(400, 'OTP not found or expired. Please request a new OTP.');
    }

    if (otpValue !== String(stored.otp)) {
      return this.fail(400, 'Invalid OTP');
    }

    if (new Date() > new Date(stored.expiresAt)) {
      this.loginOtpService.removeStoredOtp(mobileKey);
      return this.fail(400, 'OTP expired');
    }

    this.loginOtpService.removeStoredOtp(mobileKey);
    return null;
  }

  @Get('google/config')
  getGoogleConfig() {
    return this.authService.getPublicGoogleConfig();
  }

  @Get('google')
  googleAuth(@Res() res: Response) {
    return res.redirect(this.authService.getGoogleAuthUrl());
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontend = this.getFrontendUrl();

    if (error || !code) {
      return res.redirect(`${frontend}/signup/?error=google_auth_failed`);
    }

    try {
      const { user } = await this.authService.loginWithGoogleCode(code);
      const account = await this.authService.createAccount({
        fullName: user.name,
        email: user.email,
        googleId: user.sub,
      });

      const accessToken = await this.authService.generateToken({
        sub: user.sub,
        email: user.email,
        name: user.name,
        picture: user.picture,
        googleId: user.sub,
        ...(account.data || {}),
      });

      const params = new URLSearchParams({ token: accessToken });
      if (user.email) params.set('email', user.email);
      if (user.name) params.set('name', user.name);
      if (user.sub) params.set('googleId', user.sub);

      return res.redirect(
        `${frontend}/auth/google-success/?${params.toString()}`,
      );
    } catch (err) {
      this.logger.error('Google callback failed', err);
      return res.redirect(`${frontend}/signup/?error=google_auth_failed`);
    }
  }

  @Post('google-login')
  async googleLogin(@Body() dto: GoogleLoginDto): Promise<ApiResponse> {
    try {
      const isGoogleSignup = Boolean(dto.googleId?.trim());

      if (!isGoogleSignup) {
        if (!dto.fullName?.trim()) {
          return this.fail(400, 'Full name is required');
        }
        if (!dto.email?.trim()) {
          return this.fail(400, 'Email is required');
        }
        if (!dto.password?.trim()) {
          return this.fail(400, 'Password is required');
        }

        const otpError = this.verifyStoredOtp(dto.mobile, dto.otp);
        if (otpError) {
          return otpError;
        }
      }

      const payload: GoogleLoginDto = {
        ...dto,
        fullName: dto.fullName?.trim(),
        email: dto.email?.trim(),
        mobile: this.normalizeMobile(dto.mobile) || undefined,
        googleId: dto.googleId?.trim() || undefined,
      };

      const result = await this.authService.createAccount(payload);
      const accessToken = await this.authService.generateToken({
        email: payload.email,
        name: payload.fullName,
        mobile: payload.mobile,
        googleId: payload.googleId,
        ...(result.data || {}),
      });

      return this.ok(result.message, {
        ...(result.data || {}),
        accessToken,
      });
    } catch (error) {
      this.logger.error('google-login failed', error);
      return this.fail(500, 'Failed to create account');
    }
  }

  @Post('newsend-email-txtmsg')
  async sendEmailTxtnewMsg(
    @Body() sendEmailDto: SendOTPEmailMessageDto,
  ): Promise<ApiResponse> {
    const mobile = this.normalizeMobile(sendEmailDto.mobile);

    if (mobile.length < 10) {
      return this.fail(400, 'Valid 10-digit mobile number is required');
    }

    try {
      const otp = this.helperService.generateRandomNumber();
      const otpStr = otp.toString();
      const lastSixDigits =
        await this.helperService.getLastSixDigits(otpStr);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      this.loginOtpService.storeOtp(mobile, otpStr, expiresAt);

      const message = `Welcome to Infinity, Your OTP to Login to Infinity TechCare Lounge is ${lastSixDigits}. For Help, Call Infinity 8447882424. 9AM-6PM Mon-Sat`;
      await this.helperService.sendSms(
        mobile,
        message,
        '1107162426891569578',
      );

      return this.ok('OTP sent successfully', null);
    } catch (error) {
      this.logger.error('Failed to send OTP SMS', error);
      return this.fail(500, 'Failed to send OTP. Please try again.');
    }
  }

  @Post('newloginhotcustomerpboth')
  async newlog(@Body() dto: logininfoDTO): Promise<ApiResponse> {
    try {
      const otpError = this.verifyStoredOtp(dto.mobile, dto.otp);
      if (otpError) {
        return otpError;
      }

      const mobile = this.normalizeMobile(dto.mobile);
      const userArray = await this.authService.newprofileloginBoth({
        mobile,
        otp: dto.otp,
      });
      const user = userArray?.[0];

      const isNotRegistered =
        !user ||
        Number(user.Success) === 0 ||
        /not regist/i.test(String(user.Message ?? ''));

      const mid = Math.floor(Math.random() * 900) + 100;
      const tokenPayload = user
        ? { ...user, mobile: user.mobile || mobile }
        : { mobile };
      const accessToken = await this.authService.generateToken(tokenPayload);

      if (isNotRegistered) {
        return {
          statusCode: 200,
          isSuccess: false,
          message: user?.Message || 'Mobile number not registered',
          data: {
            mobile: user?.mobile || mobile,
            email: user?.email ?? null,
            Success: user?.Success ?? 0,
            mid,
            accessToken,
          },
        };
      }

      return this.ok('Logged in successfully', { ...user, mid, accessToken });
    } catch (error) {
      this.logger.error('OTP login failed', error);
      return this.fail(500, 'Internal server error');
    }
  }
}
