import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseService } from 'src/database/database.service';
import { PersonInfoService } from './personinfo.service';
import { PersonInfoController } from './personinfo.controller';
import { HelperService } from 'src/helper/helper.service';
import { WhatsappService } from 'src/helper/whatsapp.service';
<<<<<<< HEAD
import { MeetingSchedulerService } from './meeting-scheduler.service';
=======
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10

@Module({
  imports: [HttpModule],
  controllers: [PersonInfoController],
<<<<<<< HEAD
  providers: [
    PersonInfoService,
    DatabaseService,
    HelperService,
    WhatsappService,
    MeetingSchedulerService,
  ],
=======
  providers: [PersonInfoService, DatabaseService, HelperService, WhatsappService],
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
})
export class PersonInfoModule { }