import { Module } from '@nestjs/common';

import { agentDecisionGateway, DeterministicAgentDecisionGateway } from './agent-decision.gateway';
import { gameSessionClock, nativeGameSessionClock } from './game-session-clock';
import { GameSessionsController } from './game-sessions.controller';
import { GameSessionsService } from './game-sessions.service';

@Module({
  controllers: [GameSessionsController],
  providers: [
    GameSessionsService,
    { provide: gameSessionClock, useValue: nativeGameSessionClock },
    { provide: agentDecisionGateway, useClass: DeterministicAgentDecisionGateway },
  ],
})
export class GameSessionsModule {}
