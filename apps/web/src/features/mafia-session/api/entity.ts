import type { MafiaGameProjection } from '@repo/mafia';
import { err, ok, Result } from 'neverthrow';

import type { GameSessionApiError } from './error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMafiaGameProjection(value: unknown): value is MafiaGameProjection {
  if (!isRecord(value) || !isRecord(value.public) || !isRecord(value.personal)) {
    return false;
  }

  const { public: publicInformation, personal: personalInformation } = value;
  return (
    typeof value.eventId === 'number' &&
    typeof value.sessionId === 'string' &&
    ['day-discussion', 'nomination', 'final-defence', 'verdict', 'completed'].includes(
      String(publicInformation.phase),
    ) &&
    typeof publicInformation.dayNumber === 'number' &&
    typeof publicInformation.phaseDeadline === 'string' &&
    Array.isArray(publicInformation.participants) &&
    publicInformation.participants.every(
      (participant) =>
        isRecord(participant) &&
        typeof participant.id === 'string' &&
        typeof participant.name === 'string' &&
        typeof participant.alive === 'boolean',
    ) &&
    (typeof publicInformation.nominatedParticipantId === 'string' ||
      publicInformation.nominatedParticipantId === null ||
      publicInformation.nominatedParticipantId === undefined) &&
    Array.isArray(publicInformation.timeline) &&
    (publicInformation.voteStatus === null ||
      publicInformation.voteStatus === undefined ||
      (isRecord(publicInformation.voteStatus) &&
        ['nomination', 'verdict'].includes(String(publicInformation.voteStatus.phase)) &&
        Array.isArray(publicInformation.voteStatus.submittedParticipantIds) &&
        publicInformation.voteStatus.submittedParticipantIds.every(
          (participantId) => typeof participantId === 'string',
        ))) &&
    Array.isArray(publicInformation.completedVoteRecords) &&
    typeof personalInformation.participantId === 'string' &&
    ['Mafia', 'Detective', 'Doctor', 'Citizen'].includes(String(personalInformation.role)) &&
    ['Mafia', 'Citizen'].includes(String(personalInformation.allegiance))
  );
}

export function validateMafiaGameProjection(
  value: unknown,
): Result<MafiaGameProjection, GameSessionApiError> {
  return isMafiaGameProjection(value)
    ? ok(value)
    : err({ type: 'invalid-event', cause: value } satisfies GameSessionApiError);
}

export function parseMafiaGameProjection(
  data: string,
): Result<MafiaGameProjection, GameSessionApiError> {
  return Result.fromThrowable(JSON.parse, (cause): GameSessionApiError => ({
    type: 'invalid-event',
    cause,
  }))(data).andThen(validateMafiaGameProjection);
}
