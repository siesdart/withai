import { randomInt } from 'node:crypto';

import type { GameModule } from '@repo/game-contract';
import { err, ok, type Result } from 'neverthrow';

import { mafiaGameConfig } from './config';
import type { MafiaDayDurations } from './config';
import {
  MafiaGameSession,
  type MafiaProjectionError,
  type MafiaPublicInformation,
} from './mafia-game-session';
import {
  createParticipants,
  type MafiaOutputLanguage,
  type MafiaPersonalInformation,
  type RandomInt,
} from './participants';

export type MafiaSessionInput = {
  sessionId: string;
  participantCount: number;
};
export type MafiaSessionInputError = {
  type: 'invalid-participant-count';
  participantCount: number;
};

const defaultDayDurations: MafiaDayDurations = {
  discussionDurationMs: mafiaGameConfig.discussionDurationMs,
  nominationDurationMs: mafiaGameConfig.nominationDurationMs,
  finalDefenceDurationMs: mafiaGameConfig.finalDefenceDurationMs,
  verdictDurationMs: mafiaGameConfig.verdictDurationMs,
  nightDurationMs: mafiaGameConfig.nightDurationMs,
};

export class MafiaGameModule implements GameModule<
  MafiaSessionInput,
  MafiaPublicInformation,
  MafiaPersonalInformation,
  MafiaSessionInputError,
  MafiaProjectionError
> {
  constructor(
    private readonly randomIntExclusive: RandomInt = randomInt,
    private readonly dayDurations: MafiaDayDurations = defaultDayDurations,
    private readonly now: () => Date = () => new Date(),
    private readonly outputLanguage: MafiaOutputLanguage = 'ko',
  ) {}
  create({
    sessionId,
    participantCount,
  }: MafiaSessionInput): Result<MafiaGameSession, MafiaSessionInputError> {
    if (
      participantCount < mafiaGameConfig.minParticipantCount ||
      participantCount > mafiaGameConfig.maxParticipantCount
    )
      return err({ type: 'invalid-participant-count', participantCount });
    return ok(
      new MafiaGameSession(
        sessionId,
        createParticipants(participantCount, this.randomIntExclusive, this.outputLanguage),
        this.dayDurations,
        this.now,
      ),
    );
  }
}
