import { ApiProperty } from '@nestjs/swagger';
<<<<<<< HEAD
import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
=======

>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
export class GetServiceCallDTO {

  @ApiProperty()
  quNumber?: string;

  @ApiProperty()
  userid?: string;
}


export class SendMeetingDTO {

  @ApiProperty()
  meetingLink?: string;

  @ApiProperty()
  quNumber?: string;

  @ApiProperty()
  participantName?: string;

  @ApiProperty()
  userEmail?: string;

  @ApiProperty()
  userMobile?: string;

  @ApiProperty({ required: false })
  customerEmail?: string;

  @ApiProperty({ required: false })
  customerMobile?: string;

  @ApiProperty({ required: false })
  alternateEmail?: string;

  @ApiProperty({ required: false })
  alternateMobile?: string;
<<<<<<< HEAD

  @ApiProperty({
    required: false,
    example: '2026-06-22T13:30:00.000Z',
    description: 'If provided, meeting link notifications are scheduled for this datetime',
  })
  @IsOptional()
  @IsISO8601()
  scheduleAt?: string;
=======
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
}

export class TestWhatsappDto {
  @ApiProperty({
    example: '9876543210',
  })
  mobile?: string;
<<<<<<< HEAD
}
export class VideoCallDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ticketNo?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  roomId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  callerId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  callerName?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  receiverId?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  receiverName?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  videoCallType?: string;
=======
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
}