import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';

type ScheduleStatus = 'scheduled' | 'running' | 'completed' | 'failed';

interface MeetingScheduleJob {
  id: string;
  runAt: string;
  createdAt: string;
  status: ScheduleStatus;
  completedAt: string | null;
  error: string | null;
  result: any;
  timeoutRef: NodeJS.Timeout;
}

@Injectable()
export class MeetingSchedulerService {
  private readonly logger = new Logger(MeetingSchedulerService.name);
  private readonly jobs = new Map<string, MeetingScheduleJob>();

  scheduleMeeting(runAt: Date, task: () => Promise<any>) {
    const id = randomUUID();
    const delayMs = Math.max(0, runAt.getTime() - Date.now());

    const job: MeetingScheduleJob = {
      id,
      runAt: runAt.toISOString(),
      createdAt: new Date().toISOString(),
      status: 'scheduled',
      completedAt: null,
      error: null,
      result: null,
      timeoutRef: setTimeout(async () => {
        const currentJob = this.jobs.get(id);
        if (!currentJob) {
          return;
        }

        currentJob.status = 'running';

        try {
          const result = await task();
          currentJob.status = 'completed';
          currentJob.result = result;
          currentJob.completedAt = new Date().toISOString();
        } catch (error) {
          currentJob.status = 'failed';
          currentJob.error = (error as Error)?.message ?? 'Unknown scheduling error';
          currentJob.completedAt = new Date().toISOString();
          this.logger.error(`Scheduled meeting send failed for job ${id}`, error);
        }
      }, delayMs),
    };

    this.jobs.set(id, job);

    return {
      scheduleId: id,
      runAt: job.runAt,
      status: job.status,
      createdAt: job.createdAt,
    };
  }

  getJobStatus(scheduleId: string) {
    const job = this.jobs.get(scheduleId);

    if (!job) {
      return null;
    }

    return {
      scheduleId: job.id,
      runAt: job.runAt,
      createdAt: job.createdAt,
      status: job.status,
      completedAt: job.completedAt,
      error: job.error,
      result: job.result,
    };
  }
}
