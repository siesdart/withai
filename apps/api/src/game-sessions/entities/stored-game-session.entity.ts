import type { MafiaGameSession } from '@repo/mafia';
import type { Dayjs } from 'dayjs';
import { type ReplaySubject } from 'rxjs';

import type { GameSessionStatus } from '../game-session-status';
import type { IdempotencyRecord } from '../idempotency/idempotency-ledger';
import type { MafiaGameSessionProjectionEntity } from './mafia-game-session-projection.entity';

export type ScheduledAgentPublicSpeech = {
  participantId: string;
  content: string;
  dueAt: string;
};

export type ScheduledAgentFinalDefence = {
  participantId: string;
  content: string;
  dueAt: string;
};

export type StoredGameSessionEntity = {
  holderId: string;
  humanParticipantId: string;
  gameSession: MafiaGameSession;
  events: ReplaySubject<MafiaGameSessionProjectionEntity>;
  nextEventId: number;
  nextPublicSpeechAt: Dayjs | undefined;
  nextFinalDefenceAt: Dayjs | undefined;
  nextDiscussionTimeAdjustmentAt: Dayjs | undefined;
  lastAccessedAt: Dayjs;
  activeEventSubscribers: number;
  status: GameSessionStatus;
  publicSpeechIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameSessionProjectionEntity>>;
  mafiaChatIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameSessionProjectionEntity>>;
  dayActionIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameSessionProjectionEntity>>;
  discussionTimeAdjustmentIdempotencyKeys: Map<
    string,
    IdempotencyRecord<MafiaGameSessionProjectionEntity>
  >;
  phaseTimer: NodeJS.Timeout | undefined;
  agentFinalDefenceTimer: NodeJS.Timeout | undefined;
  publicSpeechAgentTimers: Set<NodeJS.Timeout>;
  mafiaTargetFallbackTimer: NodeJS.Timeout | undefined;
  scheduledAgentPublicSpeeches: ScheduledAgentPublicSpeech[];
  scheduledAgentFinalDefence: ScheduledAgentFinalDefence | undefined;
  scheduledMafiaTargetFallbackAt: string | undefined;
  reconnectGraceTimer: NodeJS.Timeout | undefined;
  reconnectGraceDeadline: Dayjs | undefined;
};
