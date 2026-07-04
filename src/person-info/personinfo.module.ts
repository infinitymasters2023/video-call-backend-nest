import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseService } from 'src/database/database.service';
import { PersonInfoService } from './personinfo.service';
import { PersonInfoController } from './personinfo.controller';
import { HelperService } from 'src/helper/helper.service';
import { WhatsappService } from 'src/helper/whatsapp.service';
import { MeetingSchedulerService } from './meeting-scheduler.service';
import { AuthModule } from 'src/auth/auth.module';

@Module({
  imports: [HttpModule, AuthModule],
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