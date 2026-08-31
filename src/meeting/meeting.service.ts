import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MeetingsRepository } from './meetings.repository';
import { AuthService } from 'src/auth/auth.service';

@Injectable()
export class MeetingService {
  private readonly logger = new Logger(MeetingService.name);
  private meetings = new Map<string, any>();

  constructor(
    private readonly repo: MeetingsRepository,
    private readonly auth: AuthService,
  ) {}

  /**
   * Create a room and log it against the host.
   *
   * The in-memory map still backs getMeeting/joinMeeting exactly as before; the
   * database write is added alongside and is deliberately non-blocking — if the
   * insert fails the meeting must still start, so the error is logged and the
   * room is returned regardless.
   */
  async createMeeting(data: any, authorization?: string) {
    const roomId = randomUUID();

    const meeting = {
      roomId,
      title: data?.title,
      hostName: data?.hostName,
      participants: [],
      createdAt: new Date(),
    };

    this.meetings.set(roomId, meeting);

    // Logging runs in the background on purpose. The caller only needs the room
    // id, and the database round trips (token lookup plus insert) would
    // otherwise sit in front of it — a slow or unreachable database must never
    // be able to stall, or fail, the creation of a meeting.
    void this.logMeeting(roomId, data, authorization);

    return meeting;
  }

  private async logMeeting(
    roomId: string,
    data: any,
    authorization?: string,
  ): Promise<void> {
    try {
      // Agent-portal meetings arrive without a session; they are logged with a
      // null host and kept out of anyone's free allowance.
      const isAgent = !!data?.isAgent || !!data?.ticketNo;
      const record = await this.resolveHost(authorization);

      await this.repo.recordMeeting({
        roomId,
        hostUserId: record?.userId ?? null,
        hostName: (data?.hostName || record?.fullName || '').trim() || null,
        hostEmail: (data?.hostEmail || record?.email || '').trim().toLowerCase() || null,
        title: data?.title ?? null,
        meetingLink: data?.meetingLink ?? null,
        calendarUid: `infymeet-${roomId}@infymeet`,
        durationMinutes: Number(data?.durationMinutes) > 0 ? Number(data.durationMinutes) : null,
        meetingType: isAgent ? 'agent' : 'instant',
        ticketNo: data?.ticketNo ?? null,
        countsToQuota: !isAgent,
      });
    } catch (err) {
      this.logger.error(`Meeting ${roomId} created but not logged`, err);
    }
  }

  /** Who is calling, if they sent a bearer token. Never throws. */
  private async resolveHost(
    authorization?: string,
  ): Promise<{ userId: number; fullName: string; email: string } | null> {
    const token = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    try {
      const record = await this.auth.resolveToken(token);
      if (!record) return null;
      const pub = this.auth.publicUser(record);
      return { userId: pub.userId, fullName: pub.fullName, email: pub.email };
    } catch {
      return null;
    }
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
