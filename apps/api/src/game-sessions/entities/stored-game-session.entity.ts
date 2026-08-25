import type { GameModuleSession } from '@repo/game-contract';
import type { MafiaPersonalInformation, MafiaPublicInformation } from '@repo/mafia';
import type { Dayjs } from 'dayjs';
import { type ReplaySubject } from 'rxjs';

import type { MafiaGameSessionProjectionEntity } from './mafia-game-session-projection.entity';

export type StoredGameSessionEntity = {
  holderId: string;
  humanParticipantId: string;
  gameSession: GameModuleSession<MafiaPublicInformation, MafiaPersonalInformation>;
  events: ReplaySubject<MafiaGameSessionProjectionEntity>;
  nextEventId: number;
  lastAccessedAt: Dayjs;
  activeEventSubscribers: number;
};
