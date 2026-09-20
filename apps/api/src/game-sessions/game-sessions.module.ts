import { Module } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

import { createStructuredLogger } from '../logging/structured-logger.js';
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
      inject: [PinoLogger],
      useFactory: (logger: PinoLogger) =>
        process.env.NODE_ENV === 'test'
          ? new DeterministicAgentDecisionGateway('ko')
          : new LLMAgentDecisionGateway(undefined, 'ko', createStructuredLogger(logger)),
    },
  ],
})
export class GameSessionsModule {}
