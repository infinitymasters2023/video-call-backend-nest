import { ApiProperty } from '@nestjs/swagger';

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
}

export class TestWhatsappDto {
  @ApiProperty({
    example: '9876543210',
  })
  mobile?: string;
}