import type { MafiaGameProjection } from '@repo/mafia';
import ky from 'ky';
import { ResultAsync } from 'neverthrow';
import { parseServerSentEvents } from 'parse-sse';

import { parseMafiaGameProjection, validateMafiaGameProjection } from './entity';
import { type GameSessionApiError, toGameSessionApiError } from './error';

const gameSessionsApi = ky.create({ credentials: 'include' });

export type { MafiaGameProjection };

function requestMafiaGameProjection(
  request: Promise<unknown>,
): ResultAsync<MafiaGameProjection, GameSessionApiError> {
  return ResultAsync.fromPromise(request, toGameSessionApiError).andThen(
    validateMafiaGameProjection,
  );
}

export function createMafiaGameSession(
  idempotencyKey: string,
): ResultAsync<MafiaGameProjection, GameSessionApiError> {
  return requestMafiaGameProjection(
    gameSessionsApi
      .post('/game-sessions/mafia', {
        json: { participantCount: 5 },
        headers: { 'Idempotency-Key': idempotencyKey },
      })
      .json(),
  );
}

export function getGameSessionSnapshot(
  sessionId: string,
): ResultAsync<MafiaGameProjection, GameSessionApiError> {
  return requestMafiaGameProjection(
    gameSessionsApi.get(`/game-sessions/${sessionId}/snapshot`).json(),
  );
}

export type GameSessionSubscriptionOptions = {
  lastEventId: string | undefined;
  onConnected: () => void;
  onProjection: (projection: MafiaGameProjection, lastEventId: string) => void;
  signal: AbortSignal;
};

export function subscribeToGameSession(
  sessionId: string,
  { lastEventId, onConnected, onProjection, signal }: GameSessionSubscriptionOptions,
): ResultAsync<void, GameSessionApiError> {
  return ResultAsync.fromPromise(
    (async () => {
      const response = await gameSessionsApi.get(`/game-sessions/${sessionId}/events`, {
        headers: {
          Accept: 'text/event-stream',
          ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
        },
        signal,
      });
      onConnected();

      for await (const event of parseServerSentEvents(response)) {
        if (event.type !== 'snapshot') {
          continue;
        }

        parseMafiaGameProjection(event.data).match(
          (projection) => onProjection(projection, event.lastEventId),
          (error) => {
            throw error;
          },
        );
      }
    })(),
    toGameSessionApiError,
  );
}
