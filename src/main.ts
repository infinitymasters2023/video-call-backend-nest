import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

import {
  SwaggerModule,
  DocumentBuilder,
} from '@nestjs/swagger';

import * as bodyParser from 'body-parser';

import * as express from 'express';

async function bootstrap() {

  const app =
    await NestFactory.create(AppModule);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
    'http://localhost:3000,https://meetings.infyshield.com,http://localhost:5083')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // =========================
  // BODY SIZE LIMIT
  // =========================

  app.use(
    bodyParser.json({
      limit: '50mb',
    }),
  );

  app.use(
    bodyParser.urlencoded({
      limit: '50mb',
      extended: true,
    }),
  );

  // =========================
  // STATIC DOCUMENT FOLDER
  // =========================

  app.use(
    '/Documents',
    express.static(
      'F:/documents/videocall',
    ),
  );

  // =========================
  // SWAGGER CONFIG
  // =========================

  const config =
    new DocumentBuilder()
      .setTitle('Video Call API')
      .setDescription(
        'WebRTC Signaling APIs',
      )
      .setVersion('1.0')
      .addTag('video-call')
      .build();

  const document =
    SwaggerModule.createDocument(
      app,
      config,
    );

  SwaggerModule.setup(
    'api',
    app,
    document,
  );

  const port = Number(process.env.PORT) || 5083;
  await app.listen(port, '0.0.0.0');
}

bootstrap();