import { HTTPError } from 'ky';
import { match, P } from 'ts-pattern';

export type GameSessionApiError =
  | { type: 'unavailable'; status: 403 | 404 }
  | { type: 'action-rejected'; status: 400 | 409 }
  | { type: 'rate-limited'; retryAfterMs: number }
  | { type: 'aborted' }
  | { type: 'invalid-event'; cause: unknown }
  | { type: 'request-failed'; cause: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isGameSessionApiError(error: unknown): error is GameSessionApiError {
  if (!isRecord(error)) {
    return false;
  }

  return match(error)
    .with({ type: 'unavailable', status: P.union(403, 404) }, () => true)
    .with({ type: 'action-rejected', status: P.union(400, 409) }, () => true)
    .with({ type: 'rate-limited', retryAfterMs: P.number }, () => true)
    .with({ type: 'aborted' }, () => true)
    .with({ type: P.union('invalid-event', 'request-failed'), cause: P._ }, () => true)
    .otherwise(() => false);
}

export function toGameSessionApiError(error: unknown): GameSessionApiError {
  if (isGameSessionApiError(error)) {
    return error;
  }

  if (
    error instanceof HTTPError &&
    (error.response.status === 403 || error.response.status === 404)
  ) {
    return { type: 'unavailable', status: error.response.status };
  }

  if (
    error instanceof HTTPError &&
    (error.response.status === 400 || error.response.status === 409)
  ) {
    return { type: 'action-rejected', status: error.response.status };
  }

  if (error instanceof HTTPError && error.response.status === 429) {
    const retryAfterSeconds = Number.parseInt(error.response.headers.get('Retry-After') ?? '', 10);
    return {
      type: 'rate-limited',
      retryAfterMs: Number.isSafeInteger(retryAfterSeconds)
        ? Math.max(1, retryAfterSeconds) * 1000
        : 1000,
    };
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { type: 'aborted' };
  }

  return { type: 'request-failed', cause: error };
}

export function isUnavailableGameSession(error: unknown): error is GameSessionApiError {
  return isGameSessionApiError(error) && error.type === 'unavailable';
}
