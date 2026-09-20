import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors({
    origin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
    allowedHeaders: ['Content-Type', 'Idempotency-Key', 'Last-Event-ID', 'X-Holder-Token'],
    exposedHeaders: ['Retry-After', 'X-Holder-Token'],
  });
  app.set('trust proxy', true);

  if (process.env.NODE_ENV !== 'production') {
    const openApiConfig = new DocumentBuilder()
      .setTitle('WithAI Game Sessions API')
      .setDescription('Server-authoritative APIs for WithAI Game Sessions.')
      .setVersion('0.1.0')
      .addApiKey({ type: 'apiKey', name: 'X-Holder-Token', in: 'header' }, 'holder-token')
      .addTag('Game Sessions')
      .build();
    const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
    app.use('/docs', apiReference({ content: openApiDocument }));
  }

  app.useLogger(app.get(Logger));
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
