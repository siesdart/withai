import { Module } from '@nestjs/common';

import { agentDecisionGateway, DeterministicAgentDecisionGateway } from './agent-decision.gateway';
import { GameSessionsController } from './game-sessions.controller';
import { GameSessionsService } from './game-sessions.service';

@Module({
  controllers: [GameSessionsController],
  providers: [
    GameSessionsService,
    { provide: agentDecisionGateway, useClass: DeterministicAgentDecisionGateway },
  ],
})
export class GameSessionsModule {}
