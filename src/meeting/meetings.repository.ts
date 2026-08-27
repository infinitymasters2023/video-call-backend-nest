import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export interface MeetingRow {
  MeetingID: number;
  HostUserID: number | null;
  HostName: string | null;
  HostEmail: string | null;
  RoomID: string;
  CalendarUID: string | null;
  Title: string | null;
  MeetingLink: string | null;
  ScheduledStart: Date | null;
  DurationMinutes: number | null;
  MeetingType: string | null;
  Status: string | null;
  TicketNo: string | null;
  CountsToQuota: boolean | null;
  CreatedDate: Date | null;
}

export interface UsageRow {
  UserID: number;
  PlanID: string;
  MeetingLimit: number | null;
  MeetingsUsed: number;
  MeetingsLeft: number | null;
  PlanEndsOn: Date | null;
}

export interface RecordMeetingInput {
  roomId: string;
  hostUserId?: number | null;
  hostName?: string | null;
  hostEmail?: string | null;
  title?: string | null;
  meetingLink?: string | null;
  hostLink?: string | null;
  calendarUid?: string | null;
  scheduledStart?: Date | null;
  durationMinutes?: number | null;
  meetingType?: 'instant' | 'scheduled' | 'agent';
  ticketNo?: string | null;
  /** Agent support calls should not eat a host's free allowance. */
  countsToQuota?: boolean;
}

/**
 * Reads and writes for the meeting tables in `iapl`.
 *
 * Every write here is best-effort from the caller's point of view: a meeting
 * that cannot be logged must still start. Callers are expected to catch, and
 * the methods below log rather than blow up a live call.
 */
@Injectable()
export class MeetingsRepository {
  private readonly logger = new Logger(MeetingsRepository.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Insert a meeting, or return the existing one for that room.
   *
   * Keyed on RoomID, which carries a filtered unique index — so a retried or
   * double-clicked create records one meeting and burns one unit of quota,
   * never two.
   */
  async recordMeeting(input: RecordMeetingInput): Promise<number | null> {
    if (!input.roomId) return null;

    try {
      const rows = await this.db.query<{ MeetingID: number }>(
        `
        DECLARE @MeetingID BIGINT;
        DECLARE @ResolvedHost BIGINT = @HostUserID;

        -- An invite carries the host's email but no session, so link it back to
        -- the account here. Without this the meeting is logged but never counts
        -- toward that host's free allowance.
        IF @ResolvedHost IS NULL AND NULLIF(@HostEmail, '') IS NOT NULL
        BEGIN
          SELECT TOP 1 @ResolvedHost = UserID
          FROM dbo.infymeet_users
          WHERE Email = CAST(@HostEmail AS NVARCHAR(200))
            AND ISNULL(IsDeleted, 0) = 0;
        END

        SELECT TOP 1 @MeetingID = MeetingID
        FROM dbo.infymeet_meetings
        WHERE RoomID = CAST(@RoomID AS NVARCHAR(100))
          AND ISNULL(IsDeleted, 0) = 0;

        IF @MeetingID IS NULL
        BEGIN
          INSERT INTO dbo.infymeet_meetings
            (HostUserID, HostName, HostEmail, RoomID, CalendarUID, Title,
             MeetingLink, HostLink, ScheduledStart, DurationMinutes,
             MeetingType, Status, TicketNo, CountsToQuota, CreatedDate, IsDeleted)
          VALUES
            (@ResolvedHost, @HostName, @HostEmail, @RoomID, @CalendarUID, @Title,
             @MeetingLink, @HostLink, @ScheduledStart, @DurationMinutes,
             @MeetingType, @Status, @TicketNo, @CountsToQuota, GETDATE(), 0);
          SET @MeetingID = SCOPE_IDENTITY();
        END
        ELSE
        BEGIN
          -- Fill in anything the first write did not know yet (a room is often
          -- created before its title, schedule or host are settled).
          UPDATE dbo.infymeet_meetings
          SET HostUserID      = COALESCE(@ResolvedHost, HostUserID),
              HostName        = COALESCE(NULLIF(@HostName, ''), HostName),
              HostEmail       = COALESCE(NULLIF(@HostEmail, ''), HostEmail),
              Title           = COALESCE(NULLIF(@Title, ''), Title),
              MeetingLink     = COALESCE(NULLIF(@MeetingLink, ''), MeetingLink),
              HostLink        = COALESCE(NULLIF(@HostLink, ''), HostLink),
              CalendarUID     = COALESCE(NULLIF(@CalendarUID, ''), CalendarUID),
              ScheduledStart  = COALESCE(@ScheduledStart, ScheduledStart),
              DurationMinutes = COALESCE(@DurationMinutes, DurationMinutes),
              TicketNo        = COALESCE(NULLIF(@TicketNo, ''), TicketNo),
              UpdatedDate     = GETDATE()
          WHERE MeetingID = @MeetingID;
        END

        SELECT @MeetingID AS MeetingID;
        `,
        {
          RoomID: input.roomId,
          HostUserID: input.hostUserId ?? null,
          HostName: input.hostName ?? null,
          HostEmail: input.hostEmail ?? null,
          CalendarUID: input.calendarUid ?? null,
          Title: input.title ?? null,
          MeetingLink: input.meetingLink ?? null,
          HostLink: input.hostLink ?? null,
          ScheduledStart: input.scheduledStart ?? null,
          DurationMinutes: input.durationMinutes ?? null,
          MeetingType: input.meetingType ?? 'instant',
          Status: input.scheduledStart ? 'scheduled' : 'active',
          TicketNo: input.ticketNo ?? null,
          CountsToQuota: input.countsToQuota === false ? false : true,
        },
      );

      return rows[0]?.MeetingID ? Number(rows[0].MeetingID) : null;
    } catch (err) {
      this.logger.error(`Could not record meeting ${input.roomId}`, err);
      return null;
    }
  }

  async findByRoomId(roomId: string): Promise<MeetingRow | null> {
    try {
      const rows = await this.db.query<MeetingRow>(
        `SELECT TOP 1 * FROM dbo.infymeet_meetings
         WHERE RoomID = CAST(@RoomID AS NVARCHAR(100)) AND ISNULL(IsDeleted, 0) = 0`,
        { RoomID: roomId },
      );
      return rows[0] ?? null;
    } catch (err) {
      this.logger.error(`Could not read meeting ${roomId}`, err);
      return null;
    }
  }

  async setStatus(roomId: string, status: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE dbo.infymeet_meetings
         SET Status = CAST(@Status AS VARCHAR(20)),
             ActualEnd = CASE WHEN @Status = 'completed' THEN GETDATE() ELSE ActualEnd END,
             UpdatedDate = GETDATE()
         WHERE RoomID = CAST(@RoomID AS NVARCHAR(100)) AND ISNULL(IsDeleted, 0) = 0`,
        { RoomID: roomId, Status: status },
      );
    } catch (err) {
      this.logger.warn(`Could not set status for ${roomId}: ${err}`);
    }
  }

  /**
   * Record who was invited. Re-invites do not duplicate a row, so the invitee
   * count on the dashboard stays honest.
   */
  async recordParticipants(
    meetingId: number,
    people: { email?: string | null; name?: string | null; role?: string; channel?: string }[],
  ): Promise<void> {
    if (!meetingId || people.length === 0) return;

    for (const person of people) {
      const email = (person.email ?? '').trim();
      if (!email) continue;
      try {
        await this.db.query(
          `
          IF NOT EXISTS (
            SELECT 1 FROM dbo.infymeet_meeting_participants
            WHERE MeetingID = CAST(@MeetingID AS BIGINT)
              AND Email = CAST(@Email AS NVARCHAR(200))
              AND ISNULL(IsDeleted, 0) = 0
          )
          BEGIN
            INSERT INTO dbo.infymeet_meeting_participants
              (MeetingID, UserID, Email, DisplayName, Role, InviteChannel, CreatedDate, IsDeleted)
            SELECT
              CAST(@MeetingID AS BIGINT),
              (SELECT TOP 1 UserID FROM dbo.infymeet_users
                WHERE Email = CAST(@Email AS NVARCHAR(200)) AND ISNULL(IsDeleted, 0) = 0),
              @Email, @DisplayName, @Role, @Channel, GETDATE(), 0;
          END
          `,
          {
            MeetingID: meetingId,
            Email: email,
            DisplayName: person.name ?? null,
            Role: person.role ?? 'guest',
            Channel: person.channel ?? 'to',
          },
        );
      } catch (err) {
        this.logger.warn(`Could not record participant ${email}: ${err}`);
      }
    }
  }

  /** Stamp someone as having actually joined. */
  async markJoined(roomId: string, email: string): Promise<void> {
    if (!roomId || !email) return;
    try {
      await this.db.query(
        `UPDATE p
         SET p.JoinedAt = COALESCE(p.JoinedAt, GETDATE())
         FROM dbo.infymeet_meeting_participants p
         INNER JOIN dbo.infymeet_meetings m ON m.MeetingID = p.MeetingID
         WHERE m.RoomID = CAST(@RoomID AS NVARCHAR(100))
           AND p.Email = CAST(@Email AS NVARCHAR(200))`,
        { RoomID: roomId, Email: email },
      );
    } catch (err) {
      this.logger.warn(`Could not mark join for ${email}: ${err}`);
    }
  }

  // ── Calendar sequence ───────────────────────────────────────────────
  //
  // iCalendar ignores an update whose SEQUENCE has not increased, so this
  // number has to keep climbing for the life of the meeting — including across
  // restarts, which is why it lives on the meeting row rather than in memory.
  //
  // Both methods return null when the CalendarSequence column is not present
  // yet, so the caller can fall back to its in-memory counter and nothing
  // breaks before the ALTER has been run.

  /** Read the current sequence without advancing it. */
  async currentCalendarSequence(roomId: string): Promise<number | null> {
    if (!roomId) return null;
    try {
      const rows = await this.db.query<{ Seq: number }>(
        `SELECT TOP 1 ISNULL(CalendarSequence, 0) AS Seq
         FROM dbo.infymeet_meetings
         WHERE RoomID = CAST(@RoomID AS NVARCHAR(100)) AND ISNULL(IsDeleted, 0) = 0`,
        { RoomID: roomId },
      );
      return rows.length ? Number(rows[0].Seq ?? 0) : null;
    } catch {
      return null;
    }
  }

  /**
   * Advance and return the sequence, atomically.
   *
   * The increment and the read happen in one statement via OUTPUT, so two
   * reschedules racing each other cannot both come back with the same number.
   */
  async nextCalendarSequence(roomId: string): Promise<number | null> {
    if (!roomId) return null;
    try {
      const rows = await this.db.query<{ Seq: number }>(
        `UPDATE dbo.infymeet_meetings
         SET CalendarSequence = ISNULL(CalendarSequence, 0) + 1,
             UpdatedDate = GETDATE()
         OUTPUT INSERTED.CalendarSequence AS Seq
         WHERE RoomID = CAST(@RoomID AS NVARCHAR(100)) AND ISNULL(IsDeleted, 0) = 0`,
        { RoomID: roomId },
      );
      return rows.length ? Number(rows[0].Seq ?? 0) : null;
    } catch {
      return null;
    }
  }

  /** Plan and quota straight from the dashboard view. */
  async getUsage(userId: number): Promise<UsageRow | null> {
    try {
      const rows = await this.db.query<UsageRow>(
        `SELECT TOP 1 UserID, PlanID, MeetingLimit, MeetingsUsed, MeetingsLeft, PlanEndsOn
         FROM dbo.vw_infymeet_user_usage
         WHERE UserID = CAST(@UserID AS BIGINT)`,
        { UserID: userId },
      );
      return rows[0] ?? null;
    } catch (err) {
      this.logger.error(`Could not read usage for user ${userId}`, err);
      return null;
    }
  }

  /** A host's own meetings, newest first — for the profile dashboard. */
  async listForHost(userId: number, limit = 20): Promise<MeetingRow[]> {
    try {
      return await this.db.query<MeetingRow>(
        `SELECT TOP (${Number(limit) || 20})
                MeetingID, RoomID, Title, MeetingLink, ScheduledStart,
                DurationMinutes, MeetingType, Status, CreatedDate
         FROM dbo.infymeet_meetings
         WHERE HostUserID = CAST(@UserID AS BIGINT) AND ISNULL(IsDeleted, 0) = 0
         ORDER BY CreatedDate DESC`,
        { UserID: userId },
      );
    } catch (err) {
      this.logger.error(`Could not list meetings for user ${userId}`, err);
      return [];
    }
  }
}
