import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

@Injectable()
export class MeetingService {
  private meetings = new Map<string, any>();

  createMeeting(data: any) {
    const roomId = randomUUID();

    const meeting = {
      roomId,
      title: data.title,
      hostName: data.hostName,
      participants: [],
      createdAt: new Date(),
    };

    this.meetings.set(roomId, meeting);

    return meeting;
  }

  getMeeting(roomId: string) {
    return this.meetings.get(roomId);
  }

  joinMeeting(roomId: string, userName: string) {
    const meeting = this.meetings.get(roomId);

    if (!meeting) {
      return { error: 'Meeting not found' };
    }

    meeting.participants.push(userName);

    return meeting;
  }
}