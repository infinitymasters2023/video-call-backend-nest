import { ApiProperty } from '@nestjs/swagger';

export class CreateMeetingDto {
  @ApiProperty({ example: 'Team Sync' })
  title: string;

  @ApiProperty({ example: 'yash' })
  hostName: string;
}