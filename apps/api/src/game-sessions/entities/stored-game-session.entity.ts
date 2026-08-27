import type { MafiaGameSession } from '@repo/mafia';
import type { Dayjs } from 'dayjs';
import { type ReplaySubject } from 'rxjs';

import type { MafiaGameSessionProjectionEntity } from './mafia-game-session-projection.entity';

export type StoredGameSessionEntity = {
  holderId: string;
  humanParticipantId: string;
  gameSession: MafiaGameSession;
  events: ReplaySubject<MafiaGameSessionProjectionEntity>;
  nextEventId: number;
  nextPublicSpeechAt: Dayjs | undefined;
  lastAccessedAt: Dayjs;
  activeEventSubscribers: number;
  publicSpeechIdempotencyKeys: Map<
    string,
    { content: string; projection: MafiaGameSessionProjectionEntity }
  >;
};
