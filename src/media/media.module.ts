import { Module } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';

@Module({
  controllers: [MediaController],
  providers: [MediaService, DatabaseService], // ✅ FIXED
})
export class MediaModule { }