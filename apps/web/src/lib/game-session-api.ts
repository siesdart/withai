import type { MafiaGameProjection } from '@repo/mafia';
import { HTTPError } from 'ky';
import ky from 'ky';
import { parseServerSentEvents } from 'parse-sse';

const gameSessionsApi = ky.create({ credentials: 'include' });

export type { MafiaGameProjection };

export async function createMafiaGameSession(idempotencyKey: string): Promise<MafiaGameProjection> {
  const response = await gameSessionsApi.post<MafiaGameProjection>('/game-sessions/mafia', {
    json: { participantCount: 5 },
    headers: { 'Idempotency-Key': idempotencyKey },
  });

  return response.json();
}

async function* gameSessionEvents(
  sessionId: string,
  lastEventId: string | undefined,
  signal?: AbortSignal,
  onConnected?: () => void,
): AsyncGenerator<{ projection: MafiaGameProjection; lastEventId: string }> {
  const response = await gameSessionsApi.get(`/game-sessions/${sessionId}/events`, {
    headers: {
      Accept: 'text/event-stream',
      ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
    },
    signal,
  });
  onConnected?.();

  for await (const event of parseServerSentEvents(response)) {
    if (event.type === 'snapshot') {
      yield {
        projection: JSON.parse(event.data),
        lastEventId: event.lastEventId,
      };
    }
  }
}

export async function getGameSessionSnapshot(sessionId: string): Promise<MafiaGameProjection> {
  const response = await gameSessionsApi.get<MafiaGameProjection>(
    `/game-sessions/${sessionId}/snapshot`,
  );

  return response.json();
}

export type GameSessionSubscriptionOptions = {
  lastEventId: string | undefined;
  onConnected: () => void;
  onProjection: (projection: MafiaGameProjection, lastEventId: string) => void;
  signal: AbortSignal;
};

export async function subscribeToGameSession(
  sessionId: string,
  { lastEventId, onConnected, onProjection, signal }: GameSessionSubscriptionOptions,
): Promise<void> {
  for await (const event of gameSessionEvents(sessionId, lastEventId, signal, onConnected)) {
    onProjection(event.projection, event.lastEventId);
  }
}

export function isUnavailableGameSession(error: unknown) {
  return error instanceof HTTPError && [403, 404].includes(error.response.status);
}
