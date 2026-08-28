import type { MafiaGameSession } from '@repo/mafia';
import type { Dayjs } from 'dayjs';
import { type ReplaySubject } from 'rxjs';

import type { IdempotencyRecord } from '../idempotency/idempotency-ledger';
import type { MafiaGameSessionProjectionEntity } from './mafia-game-session-projection.entity';

export type StoredGameSessionEntity = {
  holderId: string;
  humanParticipantId: string;
  gameSession: MafiaGameSession;
  events: ReplaySubject<MafiaGameSessionProjectionEntity>;
  nextEventId: number;
  nextPublicSpeechAt: Dayjs | undefined;
  nextFinalDefenceAt: Dayjs | undefined;
  lastAccessedAt: Dayjs;
  activeEventSubscribers: number;
  publicSpeechIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameSessionProjectionEntity>>;
  dayActionIdempotencyKeys: Map<string, IdempotencyRecord<MafiaGameSessionProjectionEntity>>;
  phaseTimer: NodeJS.Timeout | undefined;
  agentFinalDefenceTimer: NodeJS.Timeout | undefined;
};
