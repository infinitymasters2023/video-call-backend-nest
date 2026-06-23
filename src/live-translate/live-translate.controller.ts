import { Controller, Post, Body } from '@nestjs/common';
import { LiveTranslateService } from './live-translate.service';


@Controller('api')
export class LiveTranslateController {
    constructor(private readonly service: LiveTranslateService) { }

    @Post('live-translate')
    async translate(@Body() body: {
        text: string;
        sourceLang: string;
        targetLangs: string[];
        speakerName: string;
    }) {
        return this.service.translate(body);
    }
}