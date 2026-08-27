import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseService } from 'src/database/database.service';
import { PersonInfoService } from './personinfo.service';
import { PersonInfoController } from './personinfo.controller';
import { HelperService } from 'src/helper/helper.service';
import { WhatsappService } from 'src/helper/whatsapp.service';
import { MeetingSchedulerService } from './meeting-scheduler.service';
import { AuthModule } from 'src/auth/auth.module';
import { MeetingModule } from 'src/meeting/meeting.module';

@Module({
  // MeetingModule brings the meeting + scheduled-job repositories, so invites
  // and their calendar sequence numbers are written against real rows.
  imports: [HttpModule, AuthModule, MeetingModule],
  controllers: [PersonInfoController],
  providers: [
    PersonInfoService,
    DatabaseService,
    HelperService,
    WhatsappService,
    MeetingSchedulerService,
  ],
})
export class PersonInfoModule { }