import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { GameSessionsModule } from './game-sessions/game-sessions.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
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
