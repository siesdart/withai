import {
  ActiveMafiaGameSessionSchema,
  GuestPlayAllowanceSchema,
  type ActiveMafiaGameSession,
  type CreateDiscussionTimeAdjustmentRequest,
  type CreateMafiaChatRequest,
  type CreateMafiaGameSessionRequest,
  type CreateNominationRequest,
  type CreatePublicSpeechRequest,
  type CreateVerdictRequest,
  type GameSessionApiError,
  type GuestPlayAllowance,
  type MafiaGameProjection,
} from '@repo/api/client';
import ky from 'ky';
import { err, ok, ResultAsync } from 'neverthrow';
import { parseServerSentEvents } from 'parse-sse';
import * as v from 'valibot';

import { parseMafiaGameProjection, validateMafiaGameProjection } from './entity';
import { toGameSessionApiError } from './error';
import { addHolderTokenHeader, captureHolderToken, clearHolderToken } from './holder-token';

const gameSessionsApi = ky.create({
  baseUrl: `${import.meta.env.VITE_API_BASE_URL}/game-sessions/`,
  hooks: {
    beforeRequest: [
      ({ request }) => {
        addHolderTokenHeader(request);
      },
    ],
    afterResponse: [
      ({ response }) => {
        captureHolderToken(response);
        return response;
      },
    ],
  },
});
export type MafiaGameSessionSubscriptionOptions = {
  lastEventId: string | undefined;
  onConnected: () => void;
  onProjection: (projection: MafiaGameProjection, lastEventId: string) => void;
  signal: AbortSignal;
};

export class MafiaGameSessionClient {
  static createSession(
    idempotencyKey: string,
    settings: Pick<CreateMafiaGameSessionRequest, 'humanName' | 'outputLanguage'>,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      'mafia',
      { participantCount: 8, ...settings },
      idempotencyKey,
    );
  }

  static activeSession(): ResultAsync<ActiveMafiaGameSession | undefined, GameSessionApiError> {
    return ResultAsync.fromPromise(
      MafiaGameSessionClient.#withHolderRecovery(() =>
        gameSessionsApi.get('mafia/active').json<unknown>(),
      ),
      toGameSessionApiError,
    ).andThen((value) => {
      if (value === null) return ok(undefined);
      const parsed = v.safeParse(ActiveMafiaGameSessionSchema, value);
      return parsed.success
        ? ok(parsed.output)
        : err({ type: 'invalid-event', cause: value } as const);
    });
  }

  static guestPlayAllowance(): ResultAsync<GuestPlayAllowance, GameSessionApiError> {
    return ResultAsync.fromPromise(
      MafiaGameSessionClient.#withHolderRecovery(() =>
        gameSessionsApi.get('mafia/allowance').json<unknown>(),
      ),
      toGameSessionApiError,
    ).andThen((value) => {
      const parsed = v.safeParse(GuestPlayAllowanceSchema, value);
      return parsed.success
        ? ok(parsed.output)
        : err({ type: 'invalid-event', cause: value } as const);
    });
  }

  getSnapshot(): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(() => gameSessionsApi.get('mafia/snapshot').json());
  }

  submitPublicSpeech(
    content: CreatePublicSpeechRequest['content'],
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/public-speech',
      { content },
      idempotencyKey,
    );
  }

  submitMafiaChat(
    content: CreateMafiaChatRequest['content'],
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/mafia-chat',
      { content },
      idempotencyKey,
    );
  }

  submitNomination(
    targetParticipantId: CreateNominationRequest['targetParticipantId'],
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/nomination',
      { targetParticipantId },
      idempotencyKey,
    );
  }

  submitVerdict(
    vote: CreateVerdictRequest['vote'],
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/verdict',
      { vote },
      idempotencyKey,
    );
  }

  submitFinalDefence(
    content: CreatePublicSpeechRequest['content'],
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/final-defence',
      { content },
      idempotencyKey,
    );
  }

  submitMafiaTarget(
    targetParticipantId: CreateNominationRequest['targetParticipantId'],
    idempotencyKey: string,
  ) {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/mafia-target',
      { targetParticipantId },
      idempotencyKey,
    );
  }
  submitDoctorProtection(
    targetParticipantId: CreateNominationRequest['targetParticipantId'],
    idempotencyKey: string,
  ) {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/doctor-protection',
      { targetParticipantId },
      idempotencyKey,
    );
  }
  submitPoliceInvestigation(
    targetParticipantId: CreateNominationRequest['targetParticipantId'],
    idempotencyKey: string,
  ) {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/police-investigation',
      { targetParticipantId },
      idempotencyKey,
    );
  }

  adjustDiscussionTime(
    adjustmentSeconds: CreateDiscussionTimeAdjustmentRequest['adjustmentSeconds'],
    expectedDeadline: CreateDiscussionTimeAdjustmentRequest['expectedDeadline'],
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#postProjection(
      'mafia/actions/discussion-time-adjustment',
      { adjustmentSeconds, expectedDeadline },
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
        const response = await MafiaGameSessionClient.#withHolderRecovery(() =>
          gameSessionsApi.get('mafia/events', {
            headers: {
              Accept: 'text/event-stream',
              ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
            },
            signal,
          }),
        );
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
    request: () => Promise<unknown>,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return ResultAsync.fromPromise(
      MafiaGameSessionClient.#withHolderRecovery(request),
      toGameSessionApiError,
    ).andThen(validateMafiaGameProjection);
  }

  static #postProjection(
    path: string,
    json: Record<string, unknown>,
    idempotencyKey: string,
  ): ResultAsync<MafiaGameProjection, GameSessionApiError> {
    return MafiaGameSessionClient.#request(() =>
      gameSessionsApi
        .post(path, {
          json,
          headers: { 'Idempotency-Key': idempotencyKey },
        })
        .json(),
    );
  }

  static async #withHolderRecovery<Value>(request: () => Promise<Value>): Promise<Value> {
    try {
      return await request();
    } catch (error) {
      const apiError = toGameSessionApiError(error);
      if (apiError.type !== 'holder-token-invalid') throw error;

      clearHolderToken();
      await gameSessionsApi.get('mafia/active').json();
      return request();
    }
  }
}
