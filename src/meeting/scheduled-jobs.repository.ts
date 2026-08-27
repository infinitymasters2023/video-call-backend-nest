import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';

export interface JobRow {
  ScheduleGuid: string;
  MeetingID: number;
  HostUserID: number | null;
  RunAt: Date;
  Status: string;
  SequenceNo: number;
  Payload: string | null;
  AttemptCount: number;
  LastError: string | null;
}

/**
 * Durable storage for pending invite sends.
 *
 * The scheduler keeps its timers in memory; this table is what lets those
 * timers be rebuilt after a restart instead of the queued invites silently
 * disappearing.
 */
@Injectable()
export class ScheduledJobsRepository {
  private readonly logger = new Logger(ScheduledJobsRepository.name);

  constructor(private readonly db: DatabaseService) {}

  async save(input: {
    scheduleGuid: string;
    meetingId: number;
    hostUserId?: number | null;
    runAt: Date;
    payload: unknown;
    sequenceNo?: number;
  }): Promise<void> {
    try {
      await this.db.query(
        `
        IF EXISTS (
          SELECT 1 FROM dbo.infymeet_scheduled_jobs
          WHERE ScheduleGuid = CAST(@ScheduleGuid AS UNIQUEIDENTIFIER)
        )
          UPDATE dbo.infymeet_scheduled_jobs
          SET RunAt = @RunAt, Payload = @Payload,
              SequenceNo = @SequenceNo, UpdatedDate = GETDATE()
          WHERE ScheduleGuid = CAST(@ScheduleGuid AS UNIQUEIDENTIFIER);
        ELSE
          INSERT INTO dbo.infymeet_scheduled_jobs
            (ScheduleGuid, MeetingID, HostUserID, RunAt, Status, SequenceNo, Payload, CreatedDate)
          VALUES
            (CAST(@ScheduleGuid AS UNIQUEIDENTIFIER), CAST(@MeetingID AS BIGINT),
             @HostUserID, @RunAt, 'scheduled', @SequenceNo, @Payload, GETDATE());
        `,
        {
          ScheduleGuid: input.scheduleGuid,
          MeetingID: input.meetingId,
          HostUserID: input.hostUserId ?? null,
          RunAt: input.runAt,
          SequenceNo: input.sequenceNo ?? 0,
          Payload: JSON.stringify(input.payload ?? {}),
        },
      );
    } catch (err) {
      this.logger.error(`Could not persist scheduled job ${input.scheduleGuid}`, err);
    }
  }

  async setStatus(
    scheduleGuid: string,
    status: string,
    error?: string | null,
  ): Promise<void> {
    try {
      await this.db.query(
        `UPDATE dbo.infymeet_scheduled_jobs
         SET Status = CAST(@Status AS VARCHAR(20)),
             LastError = @LastError,
             AttemptCount = AttemptCount + CASE WHEN @Status IN ('completed','failed') THEN 1 ELSE 0 END,
             CompletedAt = CASE WHEN @Status IN ('completed','failed','cancelled')
                                THEN GETDATE() ELSE CompletedAt END,
             UpdatedDate = GETDATE()
         WHERE ScheduleGuid = CAST(@ScheduleGuid AS UNIQUEIDENTIFIER)`,
        { ScheduleGuid: scheduleGuid, Status: status, LastError: error ?? null },
      );
    } catch (err) {
      this.logger.warn(`Could not update job ${scheduleGuid}: ${err}`);
    }
  }

  async reschedule(scheduleGuid: string, runAt: Date): Promise<void> {
    try {
      await this.db.query(
        `UPDATE dbo.infymeet_scheduled_jobs
         SET RunAt = @RunAt, UpdatedDate = GETDATE()
         WHERE ScheduleGuid = CAST(@ScheduleGuid AS UNIQUEIDENTIFIER)`,
        { ScheduleGuid: scheduleGuid, RunAt: runAt },
      );
    } catch (err) {
      this.logger.warn(`Could not move job ${scheduleGuid}: ${err}`);
    }
  }

  /**
   * The next calendar SEQUENCE for a meeting.
   *
   * iCalendar ignores an update whose SEQUENCE has not increased, so this is
   * what makes a reschedule actually move the event in someone's calendar.
   */
  async nextSequence(meetingId: number): Promise<number> {
    try {
      const rows = await this.db.query<{ NextSeq: number }>(
        `UPDATE dbo.infymeet_scheduled_jobs
         SET SequenceNo = SequenceNo + 1, UpdatedDate = GETDATE()
         WHERE MeetingID = CAST(@MeetingID AS BIGINT);

         SELECT ISNULL(MAX(SequenceNo), 0) AS NextSeq
         FROM dbo.infymeet_scheduled_jobs
         WHERE MeetingID = CAST(@MeetingID AS BIGINT);`,
        { MeetingID: meetingId },
      );
      return Number(rows[0]?.NextSeq ?? 0);
    } catch (err) {
      this.logger.warn(`Could not bump sequence for meeting ${meetingId}: ${err}`);
      return 0;
    }
  }

  /** Jobs that still need to run — used to rebuild timers on boot. */
  async loadPending(): Promise<JobRow[]> {
    try {
      return await this.db.query<JobRow>(
        `SELECT ScheduleGuid, MeetingID, HostUserID, RunAt, Status,
                SequenceNo, Payload, AttemptCount, LastError
         FROM dbo.infymeet_scheduled_jobs
         WHERE Status = 'scheduled'
         ORDER BY RunAt ASC`,
      );
    } catch (err) {
      this.logger.error('Could not load pending scheduled jobs', err);
      return [];
    }
  }

  /** Everything for a host, for the scheduled-meetings panel. */
  async listForHost(hostEmail?: string): Promise<any[]> {
    try {
      return await this.db.query(
        `SELECT j.ScheduleGuid, j.RunAt, j.Status, j.LastError, j.CreatedDate,
                j.CompletedAt, j.Payload,
                m.RoomID, m.Title, m.MeetingLink, m.CalendarUID,
                m.DurationMinutes, m.HostName, m.HostEmail
         FROM dbo.infymeet_scheduled_jobs j
         INNER JOIN dbo.infymeet_meetings m ON m.MeetingID = j.MeetingID
         WHERE (@HostEmail = '' OR m.HostEmail = CAST(@HostEmail AS NVARCHAR(200)))
         ORDER BY j.RunAt ASC`,
        { HostEmail: (hostEmail ?? '').trim().toLowerCase() },
      );
    } catch (err) {
      this.logger.error('Could not list scheduled jobs', err);
      return [];
    }
  }
}
