import { Module } from '@nestjs/common';
import { LiveTranscribeController } from './live-transcribe.controller';
import { LiveTranscribeService } from './live-transcribe.service';

@Module({
    controllers: [LiveTranscribeController],
    providers: [LiveTranscribeService],
})
export class LiveTranscribeModule { }
