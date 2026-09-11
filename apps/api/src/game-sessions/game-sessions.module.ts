import { Module } from '@nestjs/common';

import {
  agentDecisionGateway,
  DeterministicAgentDecisionGateway,
} from './agents/agent-decision.gateway';
import { gameSessionClock, nativeGameSessionClock } from './application/game-session-clock';
import { GameSessionsService } from './application/game-sessions.service';
import { GameSessionsController } from './transport/game-sessions.controller';

@Module({
  controllers: [GameSessionsController],
  providers: [
    GameSessionsService,
    { provide: gameSessionClock, useValue: nativeGameSessionClock },
    { provide: agentDecisionGateway, useClass: DeterministicAgentDecisionGateway },
  ],
})
export class GameSessionsModule {}
