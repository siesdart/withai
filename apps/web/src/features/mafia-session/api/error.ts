import { HTTPError } from 'ky';
import { match } from 'ts-pattern';
import * as v from 'valibot';

export const GameSessionApiErrorSchema = v.variant('type', [
  v.object({ type: v.literal('holder-token-invalid') }),
  v.object({ type: v.literal('unavailable'), status: v.picklist([403, 404] as const) }),
  v.object({ type: v.literal('action-rejected'), status: v.picklist([400, 409] as const) }),
  v.object({ type: v.literal('rate-limited'), retryAfterMs: v.number() }),
  v.object({ type: v.literal('aborted') }),
  v.object({ type: v.literal('invalid-event'), cause: v.unknown() }),
  v.object({ type: v.literal('request-failed'), cause: v.unknown() }),
]);

export type GameSessionApiError = v.InferOutput<typeof GameSessionApiErrorSchema>;

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
