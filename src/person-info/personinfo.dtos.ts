import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';
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

  @ApiProperty({
    required: false,
    example: '2026-06-22T13:30:00.000Z',
    description: 'If provided, meeting link notifications are scheduled for this datetime',
  })
  @IsOptional()
  @IsISO8601()
  scheduleAt?: string;
}

export class SendCustomInviteDTO {

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  meetingLink: string;

  @ApiProperty({ type: [String], description: 'Email addresses to invite' })
  @IsNotEmpty()
  emails: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  participantName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ required: false, description: 'Optional custom message body' })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({
    required: false,
    example: '2026-06-22T13:30:00.000Z',
    description: 'If provided, the invite email is scheduled for this datetime',
  })
  @IsOptional()
  @IsISO8601()
  scheduleAt?: string;
}

export class TestWhatsappDto {
  @ApiProperty({
    example: '9876543210',
  })
  mobile?: string;
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
}