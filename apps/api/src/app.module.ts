import { Module } from '@nestjs/common';

import { GameSessionsModule } from './game-sessions/game-sessions.module';

@Module({
  imports: [GameSessionsModule],
})
export class AppModule {}
