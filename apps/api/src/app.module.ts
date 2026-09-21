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
        formatters: { level: (label) => ({ level: label }) },
        messageKey: 'message',
        genReqId: (req) => req.headers['x-request-id'] ?? randomUUID(),
        customProps: (req) => ({ requestId: req.id }),
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
