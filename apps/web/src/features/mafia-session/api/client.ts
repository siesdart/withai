import type { MafiaGameProjection } from '@repo/mafia';
import ky from 'ky';
import { ResultAsync } from 'neverthrow';
import { parseServerSentEvents } from 'parse-sse';

import { parseMafiaGameProjection, validateMafiaGameProjection } from './entity';
import { type GameSessionApiError, toGameSessionApiError } from './error';

export type { MafiaGameProjection };

const gameSessionsApi = ky.create({ baseUrl: '/game-sessions/', credentials: 'include' });

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
    return MafiaGameSessionClient.#postProjection('mafia', { participantCount: 5 }, idempotencyKey);
  }

  getSnapshot(): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi.get(`${this.#sessionId}/snapshot`).json(),
    );
  }

  submitPublicSpeech(
    content: string,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      `${this.#sessionId}/actions/public-speech`,
      { content },
      idempotencyKey,
    );
  }

  submitNomination(
    targetParticipantId: string,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      `${this.#sessionId}/actions/nomination`,
      { targetParticipantId },
      idempotencyKey,
    );
  }

  submitVerdict(
    vote: 'eliminate' | 'spare',
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      `${this.#sessionId}/actions/verdict`,
      { vote },
      idempotencyKey,
    );
  }

  submitFinalDefence(
    content: string,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      `${this.#sessionId}/actions/final-defence`,
      { content },
      idempotencyKey,
    );
  }

  adjustPhaseTime(
    adjustmentSeconds: 10 | -10,
    expectedPhase: Exclude<MafiaGameProjection['public']['phase'], 'completed'>,
    expectedPhaseDeadline: string,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      `${this.#sessionId}/actions/phase-time-adjustment`,
      { adjustmentSeconds, expectedPhase, expectedPhaseDeadline },
      idempotencyKey,
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
        const response = await gameSessionsApi.get(`${this.#sessionId}/events`, {
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

  static #postProjection(
    path: string,
    json: Record<string, unknown>,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(
      gameSessionsApi
        .post(path, {
          json,
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .json(),
    );
  }
}
