import type { GameModuleSession } from '@repo/game-contract';
import type {
  MafiaPersonalInformation,
  MafiaProjectionError,
  MafiaPublicInformation,
} from '@repo/mafia';
import type { Dayjs } from 'dayjs';
import { type ReplaySubject } from 'rxjs';

import type { MafiaGameSessionProjectionEntity } from './mafia-game-session-projection.entity';

export type StoredGameSessionEntity = {
  holderId: string;
  humanParticipantId: string;
  gameSession: GameModuleSession<
    MafiaPublicInformation,
    MafiaPersonalInformation,
    MafiaProjectionError
  >;
  events: ReplaySubject<MafiaGameSessionProjectionEntity>;
  nextEventId: number;
  lastAccessedAt: Dayjs;
  activeEventSubscribers: number;
};
