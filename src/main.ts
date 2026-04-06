import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
app.enableCors();
  // Swagger config
  const config = new DocumentBuilder()
    .setTitle('Video Call API')
    .setDescription('WebRTC Signaling APIs')
    .setVersion('1.0')
    .addTag('video-call')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(5083);
}
bootstrap();