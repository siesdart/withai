import type { MafiaGameProjection } from '@repo/mafia';
import ky from 'ky';
import { parseServerSentEvents } from 'parse-sse';

export type GameSessionProjection = MafiaGameProjection;

const gameSessionsApi = ky.create({ credentials: 'include' });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGameSessionProjection(value: unknown): value is GameSessionProjection {
  if (!isRecord(value) || !isRecord(value.public) || !isRecord(value.personal)) {
    return false;
  }

  return (
    typeof value.eventId === 'number' &&
    typeof value.sessionId === 'string' &&
    typeof value.public.phase === 'string' &&
    typeof value.public.phaseDeadline === 'string' &&
    Array.isArray(value.public.participants) &&
    value.public.participants.every(
      (participant) =>
        isRecord(participant) &&
        typeof participant.id === 'string' &&
        typeof participant.name === 'string' &&
        typeof participant.alive === 'boolean',
    ) &&
    typeof value.personal.participantId === 'string' &&
    typeof value.personal.role === 'string' &&
    typeof value.personal.allegiance === 'string'
  );
}

export function parseGameSessionProjection(value: unknown): GameSessionProjection {
  if (!isGameSessionProjection(value)) {
    throw new Error('The Game Session response is invalid.');
  }

  return value;
}

export async function createMafiaGameSession(): Promise<GameSessionProjection> {
  const response = await gameSessionsApi.post('/game-sessions/mafia', {
    json: { participantCount: 5 },
  });

  return parseGameSessionProjection(await response.json());
}

async function* gameSessionProjections(
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<GameSessionProjection> {
  const response = await gameSessionsApi.get(`/game-sessions/${sessionId}/events`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  });

  for await (const event of parseServerSentEvents(response)) {
    if (event.type === 'snapshot') {
      yield parseGameSessionProjection(JSON.parse(event.data));
    }
  }
}

export async function getInitialGameSessionSnapshot(
  sessionId: string,
): Promise<GameSessionProjection> {
  for await (const projection of gameSessionProjections(sessionId)) {
    return projection;
  }

  throw new Error('Unable to load this Game Session.');
}

export async function subscribeToGameSession(
  sessionId: string,
  onProjection: (projection: GameSessionProjection) => void,
  signal: AbortSignal,
): Promise<void> {
  for await (const projection of gameSessionProjections(sessionId, signal)) {
    onProjection(projection);
  }
}
