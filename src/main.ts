import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

import {
  SwaggerModule,
  DocumentBuilder,
} from '@nestjs/swagger';

import * as fs from 'fs';
import * as bodyParser from 'body-parser';

import * as express from 'express';

async function bootstrap() {
  const isProduction =
    (process.env.NODE_ENV || '').toLowerCase() === 'production';

  const httpsOptions = isProduction
    ? undefined
    : {
        key: fs.readFileSync(
          'D:/yash/tempdata/infymeet-nextjs/infymeet/certificates/localhost-key.pem',
        ),
        cert: fs.readFileSync(
          'D:/yash/tempdata/infymeet-nextjs/infymeet/certificates/localhost.pem',
        ),
      };

  const app = await NestFactory.create(
    AppModule,
    httpsOptions ? { httpsOptions } : {},
  );

  // const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
  //   'http://localhost:3000,https://meetings.infyshield.com,http://localhost:5083')
  //   .split(',')
  //   .map((o) => o.trim())
  //   .filter(Boolean);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
    '*')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isLocalOrLanOrigin = (origin: string) => {
    try {
      const { hostname, protocol } = new URL(origin);
      if (protocol !== 'http:' && protocol !== 'https:') return false;
      if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
      return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
    } catch {
      return false;
    }
  };

  app.enableCors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes('*') ||
        allowedOrigins.includes(origin) ||
        isLocalOrLanOrigin(origin)
      ) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
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