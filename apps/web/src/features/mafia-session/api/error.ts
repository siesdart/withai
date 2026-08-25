import { HTTPError } from 'ky';
import { match, P } from 'ts-pattern';

export type GameSessionApiError =
  | { type: 'unavailable'; status: 403 | 404 }
  | { type: 'aborted' }
  | { type: 'invalid-event'; cause: unknown }
  | { type: 'request-failed'; cause: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isGameSessionApiError(error: unknown): error is GameSessionApiError {
  if (!isRecord(error)) {
    return false;
  }

  return match(error)
    .with({ type: 'unavailable', status: P.union(403, 404) }, () => true)
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

  if (error instanceof DOMException && error.name === 'AbortError') {
    return { type: 'aborted' };
  }

  return { type: 'request-failed', cause: error };
}

export function isUnavailableGameSession(error: unknown): error is GameSessionApiError {
  return isGameSessionApiError(error) && error.type === 'unavailable';
}
