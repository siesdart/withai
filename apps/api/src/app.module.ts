import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { GameSessionsModule } from './game-sessions/game-sessions.module.js';

@Module({
  imports: [ConfigModule.forRoot({ cache: true, isGlobal: true }), GameSessionsModule],
})
export class AppModule {}
