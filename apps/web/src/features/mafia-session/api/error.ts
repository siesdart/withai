import { GameSessionApiErrorSchema, type GameSessionApiError } from '@repo/api/client';
import { HTTPError } from 'ky';
import { match } from 'ts-pattern';
import * as v from 'valibot';

export function isGameSessionApiError(error: unknown): error is GameSessionApiError {
  return v.safeParse(GameSessionApiErrorSchema, error).success;
}

export function toGameSessionApiError(error: unknown): GameSessionApiError {
  if (isGameSessionApiError(error)) {
    return error;
  }

  if (error instanceof HTTPError) {
    return match(error.response.status)
      .with(401, () => ({ type: 'holder-token-invalid' }) as const)
      .with(403, 404, (status) => ({ type: 'unavailable', status }) as const)
      .with(400, 409, (status) => ({ type: 'action-rejected', status }) as const)
      .with(429, () => ({
        type: 'rate-limited' as const,
        retryAfterMs: retryAfterMilliseconds(error.response.headers.get('Retry-After')),
      }))
      .otherwise(() => ({ type: 'request-failed' as const, cause: error }));
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { type: 'aborted' };
  }

  return { type: 'request-failed', cause: error };
}

function retryAfterMilliseconds(retryAfter: string | null): number {
  const retryAfterSeconds = Number.parseInt(retryAfter ?? '', 10);
  return Number.isSafeInteger(retryAfterSeconds) ? Math.max(1, retryAfterSeconds) * 1000 : 1000;
}

export function isUnavailableGameSession(error: unknown): error is GameSessionApiError {
  return isGameSessionApiError(error) && error.type === 'unavailable';
}
