import { Module } from '@nestjs/common';
import { LiveTranslateController } from './live-translate.controller';
import { LiveTranslateService } from './live-translate.service';

@Module({
    controllers: [LiveTranslateController],
    providers: [LiveTranslateService],
})
export class LiveTranslateModule { }