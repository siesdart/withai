import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { GameSessionsModule } from './game-sessions/game-sessions.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
        genReqId: (request, response) => {
          const requestId = request.headers['x-request-id'];
          const resolvedRequestId =
            typeof requestId === 'string' && /^[\w.:-]{1,128}$/.test(requestId)
              ? requestId
              : randomUUID();
          response.setHeader('X-Request-Id', resolvedRequestId);
          return resolvedRequestId;
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-holder-token"]',
            'req.headers["x-api-key"]',
            'req.headers["idempotency-key"]',
            'res.headers["x-holder-token"]',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        customLogLevel: (_request, response, error) => {
          if (error || response.statusCode >= 500) return 'error';
          if (response.statusCode >= 400) return 'warn';
          return 'info';
        },
        autoLogging: {
          ignore: (req) => req.url === '/health' || req.url === '/favicon.ico',
        },
      },
    }),
    ConfigModule.forRoot({ cache: true, isGlobal: true }),
    HealthModule,
    GameSessionsModule,
  ],
})
export class AppModule {}
