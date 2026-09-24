import {
  MafiaGameProjectionSchema,
  type GameSessionApiError,
  type MafiaGameProjection,
} from '@repo/api/client';
import { err, ok, Result } from 'neverthrow';
import * as v from 'valibot';

export function validateMafiaGameProjection(
  value: unknown,
): Result<MafiaGameProjection, GameSessionApiError> {
  const result = v.safeParse(MafiaGameProjectionSchema, value);
  return result.success
    ? ok(result.output)
    : err({ type: 'invalid-event', cause: value } satisfies GameSessionApiError);
}

export function parseMafiaGameProjection(
  data: string,
): Result<MafiaGameProjection, GameSessionApiError> {
  return Result.fromThrowable(JSON.parse, (cause): GameSessionApiError => ({
    type: 'invalid-event',
    cause,
  }))(data).andThen(validateMafiaGameProjection);
}
