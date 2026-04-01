import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MeetingService } from './meeting.service';
import { CreateMeetingDto } from './meeting.dto';
import { JoinMeetingDto } from './join-meeting.dto';


@ApiTags('Meeting')
@Controller('meeting')
export class MeetingController {
  constructor(private readonly meetingService: MeetingService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a meeting' })
  createMeeting(@Body() body: CreateMeetingDto) {
    return this.meetingService.createMeeting(body);
  }

  @Get(':roomId')
  @ApiOperation({ summary: 'Get meeting details' })
  getMeeting(@Param('roomId') roomId: string) {
    return this.meetingService.getMeeting(roomId);
  }

  @Post('join')
  @ApiOperation({ summary: 'Join a meeting' })
  joinMeeting(@Body() body: JoinMeetingDto) {
    return this.meetingService.joinMeeting(body.roomId, body.userName);
  }
}