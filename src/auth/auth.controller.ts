import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { GoogleLoginDto, logininfoDTO, SendOTPEmailMessageDto } from './auth.dtos';
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
  googleAuth(@Res() res: Response) {
    return res.redirect(this.authService.getGoogleAuthUrl());
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    const frontend = (this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000').replace(
      /\/$/,
      '',
    );

    if (error || !code) {
      return res.redirect(`${frontend}/signup/?error=google_auth_failed`);
    }

    try {
      const { access_token, user } = await this.authService.loginWithGoogleCode(code);
      const params = new URLSearchParams({ token: access_token });
      if (user.email) params.set('email', user.email);
      if (user.name) params.set('name', user.name);
      return res.redirect(`${frontend}/auth/google-success/?${params.toString()}`);
    } catch {
      return res.redirect(`${frontend}/signup/?error=google_auth_failed`);
    }
  }
  @Post('google-login')
  async googleLogin(
    @Body() dto: GoogleLoginDto,
  ) {
    return this.authService.googleLogin(
      dto.fullName ?? '',
      dto.email ?? '',
      dto.googleId ?? '',
      dto.mobile ?? '',
    );
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

      // ✅ Proceed to login logic (Type 42 — iapl_customerlogininfo)
      const userArray = await this.authService.createAccount(newcustomerlogininfoDTO);
      const user = userArray?.[0];

      const isNotRegistered =
        !user ||
        Number(user.Success) === 0 ||
        /not regist/i.test(String(user.Message ?? ''));

      const mid: number = Math.floor(Math.random() * 900) + 100;
      const tokenPayload = user
        ? { ...user, mobile: user.mobile || mobile }
        : { mobile };
      const accessToken: string =
        await this.authService.generateToken(tokenPayload);

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

      return {
        statusCode: 200,
        isSuccess: true,
        message: 'Logged in successfully',
        data: { ...user, mid, accessToken },
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
