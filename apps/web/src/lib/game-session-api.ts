import type { MafiaGameProjection } from '@repo/mafia';
import ky from 'ky';
import { parseServerSentEvents } from 'parse-sse';

const gameSessionsApi = ky.create({ credentials: 'include' });

export type { MafiaGameProjection };

export async function createMafiaGameSession(): Promise<MafiaGameProjection> {
  const response = await gameSessionsApi.post<MafiaGameProjection>('/game-sessions/mafia', {
    json: { participantCount: 5 },
  });

  return response.json();
}

async function* gameSessionEvents(
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<MafiaGameProjection> {
  const response = await gameSessionsApi.get(`/game-sessions/${sessionId}/events`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  });

  for await (const event of parseServerSentEvents(response)) {
    if (event.type === 'snapshot') {
      yield JSON.parse(event.data);
    }
  }
}

export async function getGameSessionSnapshot(sessionId: string): Promise<MafiaGameProjection> {
  const response = await gameSessionsApi.get<MafiaGameProjection>(
    `/game-sessions/${sessionId}/snapshot`,
  );

  return response.json();
}

export async function subscribeToGameSession(
  sessionId: string,
  onProjection: (projection: MafiaGameProjection) => void,
  signal: AbortSignal,
): Promise<void> {
  for await (const projection of gameSessionEvents(sessionId, signal)) {
    onProjection(projection);
  }
}
