import { Body, Controller, HttpStatus, Post, HttpCode, UsePipes, ValidationPipe, Get } from '@nestjs/common';

import {
  ApiTags,
} from '@nestjs/swagger';
import { MediaService } from './media.service';
import { UploadDocumentDto } from './media.dtos';


@ApiTags('Media')
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) { }


  @Post('upload')
  async uploadDocument(@Body() dto: UploadDocumentDto) {
    return this.mediaService.uploadDocument(dto);
  }
  @Get('doc')
  async docmasterdata() {
    return this.mediaService.getDocmaster();
  }


  getDocmaster
}
