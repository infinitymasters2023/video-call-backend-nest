import { Module } from '@nestjs/common';
import { MeetingController } from './meeting.controller';
import { MeetingService } from './meeting.service';
import { MeetingsRepository } from './meetings.repository';
import { ScheduledJobsRepository } from './scheduled-jobs.repository';
import { DatabaseModule } from 'src/database/database.module';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [MeetingController],
  providers: [MeetingService, MeetingsRepository, ScheduledJobsRepository],
  // person-info schedules and logs meetings too, so both repositories travel
  // with this module rather than being duplicated there.
  exports: [MeetingsRepository, ScheduledJobsRepository],
})
export class MeetingModule {}
