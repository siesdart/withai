import type { MafiaGameProjection } from '@repo/mafia';
import ky from 'ky';
import { ResultAsync } from 'neverthrow';
import { parseServerSentEvents } from 'parse-sse';

import { parseMafiaGameProjection, validateMafiaGameProjection } from './entity';
import { type GameSessionApiError, toGameSessionApiError } from './error';

export type { MafiaGameProjection };

const gameSessionsApi = ky.create({ credentials: 'include' });

export type MafiaGameSessionSubscriptionOptions = {
  lastEventId: string | undefined;
  onConnected: () => void;
  onProjection: (projection: MafiaGameProjection, lastEventId: string) => void;
  signal: AbortSignal;
};

export class MafiaGameSessionClient {
  readonly #sessionId: string;

  constructor(sessionId: string) {
    this.#sessionId = sessionId;
  }

  static createSession(
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi
        .post('game-sessions/mafia', {
          json: { participantCount: 5 },
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .json(),
    );
  }

  getSnapshot(): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi.get(`game-sessions/${this.#sessionId}/snapshot`).json(),
    );
  }

  submitPublicSpeech(
    content: string,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi
        .post(`game-sessions/${this.#sessionId}/actions/public-speech`, {
          json: { content },
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .json(),
    );
  }

  submitNomination(
    targetParticipantId: string,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi
        .post(`game-sessions/${this.#sessionId}/actions/nomination`, {
          json: { targetParticipantId },
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .json(),
    );
  }

  submitVerdict(
    vote: 'eliminate' | 'spare',
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi
        .post(`game-sessions/${this.#sessionId}/actions/verdict`, {
          json: { vote },
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .json(),
    );
  }

  submitFinalDefence(
    content: string,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi
        .post(`game-sessions/${this.#sessionId}/actions/final-defence`, {
          json: { content },
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .json(),
    );
  }

  subscribe({
    lastEventId,
    onConnected,
    onProjection,
    signal,
  }: MafiaGameSessionSubscriptionOptions): ResultAsync<void, GameSessionApiError> {
    return ResultAsync.fromPromise(
      (async () => {
        const response = await gameSessionsApi.get(`game-sessions/${this.#sessionId}/events`, {
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

  static #request(
    request: Promise<unknown>,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return ResultAsync.fromPromise(request, toGameSessionApiError).andThen(
      validateMafiaGameProjection,
    );
  }
}
