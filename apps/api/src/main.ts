import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const openApiConfig = new DocumentBuilder()
    .setTitle('WithAI Game Sessions API')
    .setDescription('Server-authoritative APIs for WithAI Game Sessions.')
    .setVersion('0.1.0')
    .addCookieAuth('withai_guest')
    .addTag('Game Sessions')
    .build();
  const openApiDocument = SwaggerModule.createDocument(app, openApiConfig);
  app.use('/docs', apiReference({ content: openApiDocument }));
  await app.listen(3000);
}

void bootstrap();
