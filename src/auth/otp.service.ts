/* eslint-disable prettier/prettier */
import { Injectable } from '@nestjs/common';

@Injectable()
export class OtpService {
  private otp: string;

  setOtp(otp: string) {
    this.otp = otp;
  }
  setprofileOtp(otp: string) {
    this.otp = otp;
  }

  getOtp(): string {
    return this.otp;
  }
}

@Injectable()
export class loginotpservice {
  private otpStore: Map<string, { otp: string; expiresAt: Date }> = new Map();

  private normalizeMobile(mobile: string | number): string {
    return String(mobile ?? '')
      .trim()
      .replace(/\D/g, '')
      .slice(-10);
  }

  storeOtp(mobile: string | number, otp: string, expiresAt: Date) {
    const key = this.normalizeMobile(mobile);
    if (!key) {
      return;
    }
    this.otpStore.set(key, { otp: String(otp), expiresAt });
  }

  getStoredOtp(mobile: string | number) {
    const key = this.normalizeMobile(mobile);
    if (!key) {
      return undefined;
    }
    return this.otpStore.get(key);
  }

  removeStoredOtp(mobile: string | number) {
    const key = this.normalizeMobile(mobile);
    if (!key) {
      return;
    }
    this.otpStore.delete(key);
  }
}

@Injectable()
export class EmailOtpService {
  private otpStore: Map<string, string> = new Map();

  setEmailOtp(key: string, value: string): void {
    this.otpStore.set(key, value);
  }

  getEmailOtp(key: string): string | undefined {
    return this.otpStore.get(key);
  }

  deleteEmailOtp(key: string): void {
    this.otpStore.delete(key);
  }
}
