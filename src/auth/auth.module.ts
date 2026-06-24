import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from 'src/database/database.module';
import { HelperService } from 'src/helper/helper.service';
import { loginotpservice } from './otp.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HttpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expires = config.get<string>('ACCESS_TOKEN_EXPIRED') || '24d';
        return {
          secret:
            config.get<string>('JWT_SECRET') ||
            config.get<string>('ACCESS_TOKEN_SECRET_KEY') ||
            'change-me',
          signOptions: {
            expiresIn: expires as `${number}d`,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, HelperService, loginotpservice],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
