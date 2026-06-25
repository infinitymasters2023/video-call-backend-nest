import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LiveTranscribeService } from './live-transcribe.service';

@Controller('api')
export class LiveTranscribeController {
    constructor(private readonly service: LiveTranscribeService) { }

    @Post('live-transcribe')
    @UseInterceptors(FileInterceptor('audio'))
    transcribe(@UploadedFile() file: Express.Multer.File) {
        return this.service.transcribe(file);
    }
}
