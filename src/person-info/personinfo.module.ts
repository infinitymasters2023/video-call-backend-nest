import { Module } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { PersonInfoService } from './personinfo.service';
import { PersonInfoController } from './personinfo.controller';
import { HelperService } from 'src/helper/helper.service';

@Module({
  controllers: [PersonInfoController],
  providers: [PersonInfoService, DatabaseService, HelperService], // ✅ FIXED
})
export class PersonInfoModule { }