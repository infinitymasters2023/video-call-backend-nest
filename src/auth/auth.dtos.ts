import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class LoginDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    email!: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    password!: string;
}

export class ContactCodeDto {
    @ApiProperty({ enum: ['email', 'mobile'] })
    @IsNotEmpty()
    @IsString()
    channel!: 'email' | 'mobile';

    @ApiProperty()
    @IsString()
    email?: string;

    @ApiProperty()
    @IsString()
    mobile?: string;

    /** Only required when verifying. */
    @ApiProperty({ required: false })
    code?: string;
}

export class AvailabilityDto {
    @ApiProperty({ required: false })
    email?: string;

    @ApiProperty({ required: false })
    mobile?: string;
}

export class ForgotPasswordDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    email!: string;
}

export class ResetPasswordDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    email!: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    otp!: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    newPassword!: string;
}

export class CompleteProfileDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    mobile!: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    otp!: string;
}

export class AvatarDto {
    /** A data URL of the resized image, or null to remove the current photo. */
    @ApiProperty({ required: false, nullable: true })
    image?: string | null;
}

export class GoogleLoginDto {
    fullName?: string;
    email?: string;
    googleId?: string;
    mobile?: string;
    password?: string;
    otp?: string;
}
export class SendOTPEmailMessageDto {


    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    mobile?: string;
}
export class logininfoDTO {



    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    mobile?: string;

    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    otp?: string;


}