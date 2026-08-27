import { Module } from '@nestjs/common';

import { agentSpeechGateway, DeterministicAgentSpeechGateway } from './agent-speech.gateway';
import { GameSessionsController } from './game-sessions.controller';
import { GameSessionsService } from './game-sessions.service';

@Module({
  controllers: [GameSessionsController],
  providers: [
    GameSessionsService,
    { provide: agentSpeechGateway, useClass: DeterministicAgentSpeechGateway },
  ],
})
export class GameSessionsModule {}
