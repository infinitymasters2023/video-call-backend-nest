import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SignalingGateway } from './signaling/signaling.gateway';
import { RoomController } from './room/room.controller';
import { MeetingModule } from './meeting/meeting.module';

@Module({
  imports: [MeetingModule],
  controllers: [AppController, RoomController],
  providers: [AppService, SignalingGateway],
})
export class AppModule {}
