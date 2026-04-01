import { ApiProperty } from '@nestjs/swagger';

export class JoinMeetingDto {
  @ApiProperty()
  roomId: string;

  @ApiProperty()
  userName: string;
}