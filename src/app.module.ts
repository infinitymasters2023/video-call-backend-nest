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
<<<<<<< HEAD
import { LiveTranscribeModule } from './live-transcribe/live-transcribe.module';
=======
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    DatabaseModule,
    LiveTranslateModule,
<<<<<<< HEAD
    LiveTranscribeModule,
=======
>>>>>>> 26b7d8a42141b511da941f95f5c6ae14e2661c10
    MediaModule,
    PersonInfoModule,
    MeetingModule],
  controllers: [AppController, RoomController],
  providers: [AppService, SignalingGateway],
})
export class AppModule { }
