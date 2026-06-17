import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SignalingGateway } from './signaling/signaling.gateway';
import { RoomController } from './room/room.controller';
import { MeetingModule } from './meeting/meeting.module';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { MediaModule } from './media/media.module';
import { PersonInfoModule } from './person-info/personinfo.module';
import { LiveTranslateModule } from './live-translate/live-translate.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    LiveTranslateModule,
    MediaModule,
    PersonInfoModule,
    MeetingModule],
  controllers: [AppController, RoomController],
  providers: [AppService, SignalingGateway],
})
export class AppModule { }
