import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

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