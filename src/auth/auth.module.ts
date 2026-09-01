import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from 'src/database/database.module';
import { HelperService } from 'src/helper/helper.service';
import { loginotpservice } from './otp.service';
import { UsersRepository } from './users.repository';
import { PasswordResetService } from './password-reset.service';
import { ContactVerificationService } from './contact-verification.service';
import { SubscriptionService } from './subscription.service';
import { MeetingsRepository } from 'src/meeting/meetings.repository';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HttpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expires = config.get<string>('ACCESS_TOKEN_EXPIRED') || '1h';
        return {
          secret:
            config.get<string>('JWT_SECRET') ||
            config.get<string>('ACCESS_TOKEN_SECRET_KEY') ||
            'change-me',
          signOptions: {
            expiresIn: expires as `${number}${'h' | 'd' | 'm' | 's'}`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController, BillingController],
  providers: [
    AuthService,
    HelperService,
    loginotpservice,
    UsersRepository,
    PasswordResetService,
    ContactVerificationService,
    SubscriptionService,
    BillingService,
    MeetingsRepository,
  ],
  exports: [AuthService, UsersRepository, JwtModule],
})
export class AuthModule {}
