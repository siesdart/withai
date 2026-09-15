import { Module } from '@nestjs/common';

import {
  agentDecisionGateway,
  DeterministicAgentDecisionGateway,
  LLMAgentDecisionGateway,
} from './agents/agent-decision.gateway.js';
import { gameSessionClock, nativeGameSessionClock } from './application/game-session-clock.js';
import { GameSessionsService } from './application/game-sessions.service.js';
import { GameSessionsController } from './transport/game-sessions.controller.js';

@Module({
  controllers: [GameSessionsController],
  providers: [
    GameSessionsService,
    { provide: gameSessionClock, useValue: nativeGameSessionClock },
    {
      provide: agentDecisionGateway,
      useFactory: () =>
        process.env.NODE_ENV === 'test'
          ? new DeterministicAgentDecisionGateway('ko')
          : new LLMAgentDecisionGateway(undefined, 'ko'),
    },
  ],
})
export class GameSessionsModule {}
