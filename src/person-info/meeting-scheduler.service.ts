import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ScheduledJobsRepository } from 'src/meeting/scheduled-jobs.repository';

type ScheduleStatus =
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** What a scheduled meeting looks like to the people managing it. */
export interface ScheduleMeta {
  /** Row id in dbo.infymeet_meetings, so jobs can be persisted against it. */
  meetingId?: number;
  /** Stable calendar UID, so reschedules and cancellations hit the same event. */
  uid?: string;
  meetingLink?: string;
  title?: string;
  hostName?: string;
  hostEmail?: string;
  emails?: string[];
  durationMinutes?: number;
  /** When the meeting itself starts — distinct from when this job runs. */
  meetingAt?: string;
}

interface MeetingScheduleJob {
  id: string;
  runAt: string;
  createdAt: string;
  status: ScheduleStatus;
  completedAt: string | null;
  error: string | null;
  result: any;
  meta: ScheduleMeta;
  task: () => Promise<any>;
  timeoutRef: NodeJS.Timeout | null;
}

@Injectable()
export class MeetingSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(MeetingSchedulerService.name);
  private readonly jobs = new Map<string, MeetingScheduleJob>();

  constructor(private readonly store: ScheduledJobsRepository) {}

  async onModuleInit(): Promise<void> {
    // Nothing to do here: the work each job performs is a closure the caller
    // owns, so restoring timers needs the caller's task factory. See
    // restorePending, which PersonInfoController calls on its own init.
  }

  /**
   * Rebuild timers for jobs that were still pending when the process stopped.
   *
   * Without this a restart leaves rows sitting at 'scheduled' with no timer
   * behind them — the list would show invites that were never going to send.
   * The stored payload is enough to reconstruct the task, so the caller passes
   * a factory that turns it back into work.
   */
  async restorePending(
    taskFactory: (payload: any) => () => Promise<any>,
  ): Promise<{ restored: number; expired: number }> {
    const pending = await this.store.loadPending();
    let restored = 0;
    let expired = 0;

    for (const row of pending) {
      const id = String(row.ScheduleGuid).toLowerCase();
      if (this.jobs.has(id)) continue;

      let payload: any = {};
      try {
        payload = row.Payload ? JSON.parse(row.Payload) : {};
      } catch {
        /* unusable payload — treated as expired below */
      }

      const runAt = new Date(row.RunAt);

      // Already due, or nothing left to send it with: mark it rather than
      // leaving a row that claims to be scheduled forever.
      if (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now()) {
        expired += 1;
        await this.store.setStatus(
          row.ScheduleGuid,
          'failed',
          'The server restarted before this invite was due to send.',
        );
        continue;
      }

      const job: MeetingScheduleJob = {
        id,
        runAt: runAt.toISOString(),
        createdAt: new Date().toISOString(),
        status: 'scheduled',
        completedAt: null,
        error: null,
        result: null,
        meta: payload ?? {},
        task: taskFactory(payload),
        timeoutRef: null,
      };

      this.jobs.set(id, job);
      this.arm(job, runAt);
      restored += 1;
    }

    if (restored || expired) {
      this.logger.log(
        `Scheduled invites after restart: ${restored} timer(s) restored, ${expired} expired.`,
      );
    }
    return { restored, expired };
  }

  /**
   * How many times a meeting's calendar event has been revised.
   *
   * iCalendar requires SEQUENCE to increase on every update, otherwise
   * calendars ignore the change and the original event stays put.
   */
  private readonly sequences = new Map<string, number>();

  /**
   * Normalise a schedule id before using it as a map key.
   *
   * randomUUID() yields lowercase but SQL Server returns uniqueidentifier in
   * uppercase, so a job restored from the database would never be found again
   * without folding the case.
   */
  private key(scheduleId: string): string {
    return String(scheduleId ?? '').trim().toLowerCase();
  }

  currentSequence(uid: string): number {
    return this.sequences.get(uid) ?? 0;
  }

  /**
   * Adopt a sequence decided elsewhere (the durable one on the meeting row),
   * so the in-memory fallback can never hand back a lower number later.
   */
  setSequence(uid: string, value: number): void {
    if (!uid || !Number.isFinite(value)) return;
    this.sequences.set(uid, Math.max(this.currentSequence(uid), Number(value)));
  }

  /** Bump and return the next sequence for a meeting's calendar event. */
  nextSequence(uid: string): number {
    const next = this.currentSequence(uid) + 1;
    this.sequences.set(uid, next);
    return next;
  }

  scheduleMeeting(runAt: Date, task: () => Promise<any>, meta: ScheduleMeta = {}) {
    const id = this.key(randomUUID());
    const job: MeetingScheduleJob = {
      id,
      runAt: runAt.toISOString(),
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      completedAt: null,
      error: null,
      result: null,
      meta,
      task,
      timeoutRef: null,
    };

    this.jobs.set(id, job);
    this.arm(job, runAt);

    // Best effort: a job that cannot be written down still runs in this
    // process, it just will not survive a restart.
    if (meta.meetingId) {
      void this.store.save({
        scheduleGuid: id,
        meetingId: meta.meetingId,
        runAt,
        payload: meta,
      });
    }

    return {
      scheduleId: id,
      runAt: job.runAt,
      status: job.status,
      createdAt: job.createdAt,
    };
  }

  /**
   * (Re)start the timer for a job.
   *
   * setTimeout tops out at ~24.8 days; a longer wait is re-armed in chunks so a
   * meeting booked further ahead than that still fires instead of firing
   * immediately, which is what a raw overflowing delay does.
   */
  private arm(job: MeetingScheduleJob, runAt: Date): void {
    const MAX_DELAY = 2_147_483_647;
    const remaining = Math.max(0, runAt.getTime() - Date.now());

    if (remaining > MAX_DELAY) {
      job.timeoutRef = setTimeout(() => {
        if (this.jobs.get(job.id)?.status !== 'scheduled') return;
        this.arm(job, runAt);
      }, MAX_DELAY);
      return;
    }

    job.timeoutRef = setTimeout(async () => {
      const current = this.jobs.get(this.key(job.id));
      if (!current || current.status !== 'scheduled') return;

      current.status = 'running';
      void this.store.setStatus(job.id, 'running');
      try {
        current.result = await current.task();
        current.status = 'completed';
        void this.store.setStatus(job.id, 'completed');
      } catch (error) {
        current.status = 'failed';
        current.error = (error as Error)?.message ?? 'Unknown scheduling error';
        void this.store.setStatus(job.id, 'failed', current.error);
        this.logger.error(`Scheduled meeting send failed for job ${job.id}`, error);
      } finally {
        current.completedAt = new Date().toISOString();
      }
    }, remaining);
  }

  /** Move a pending job to a new time. Only something not yet sent can move. */
  reschedule(scheduleId: string, runAt: Date): { ok: boolean; reason?: string } {
    const job = this.jobs.get(this.key(scheduleId));
    if (!job) return { ok: false, reason: 'not_found' };
    if (job.status !== 'scheduled') return { ok: false, reason: job.status };

    if (job.timeoutRef) clearTimeout(job.timeoutRef);
    job.runAt = runAt.toISOString();
    this.arm(job, runAt);
    void this.store.reschedule(scheduleId, runAt);
    return { ok: true };
  }

  /** Stop a pending job. Already-sent invites cannot be unsent. */
  cancel(scheduleId: string): { ok: boolean; reason?: string } {
    const job = this.jobs.get(this.key(scheduleId));
    if (!job) return { ok: false, reason: 'not_found' };
    if (job.status !== 'scheduled') return { ok: false, reason: job.status };

    if (job.timeoutRef) clearTimeout(job.timeoutRef);
    job.timeoutRef = null;
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    void this.store.setStatus(scheduleId, 'cancelled');
    return { ok: true };
  }

  /** Merge fields into a job's stored meta (used when a meeting time moves). */
  updateMeta(scheduleId: string, patch: Partial<ScheduleMeta>): void {
    const job = this.jobs.get(this.key(scheduleId));
    if (!job) return;
    job.meta = { ...job.meta, ...patch };
    if (job.meta.meetingId) {
      void this.store.save({
        scheduleGuid: job.id,
        meetingId: job.meta.meetingId,
        runAt: new Date(job.runAt),
        payload: job.meta,
      });
    }
  }

  /** Public shape used by the list endpoint. */
  getJobStatus(scheduleId: string) {
    const job = this.jobs.get(this.key(scheduleId));
    return job ? this.toPublic(job) : null;
  }

  /**
   * Every job this process knows about, soonest first.
   *
   * Jobs live in memory, so an API restart clears them — the calendar invites
   * already delivered are unaffected, but anything still pending is lost. A
   * table would be needed to survive restarts.
   */
  listJobs(filter?: { hostEmail?: string }) {
    const host = filter?.hostEmail?.trim().toLowerCase();
    return [...this.jobs.values()]
      .filter((j) => !host || (j.meta.hostEmail ?? '').toLowerCase() === host)
      .sort((a, b) => a.runAt.localeCompare(b.runAt))
      .map((j) => this.toPublic(j));
  }

  private toPublic(job: MeetingScheduleJob) {
    return {
      scheduleId: job.id,
      runAt: job.meta.meetingAt ?? job.runAt,
      reminderAt: job.runAt,
      createdAt: job.createdAt,
      status: job.status,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result,
      meta: job.meta,
    };
  }
}
