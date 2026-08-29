import type { MafiaGameProjection } from '@repo/mafia/client';
import { mutationOptions, type QueryClient } from '@tanstack/react-query';
import type { ResultAsync } from 'neverthrow';

import type { GameSessionApiError } from '../../api/error';
import { isGameSessionApiError } from '../../api/error';
import { gameSessionSnapshotOptions } from './game-session-snapshot-options';

type GameSessionMutationConfig<Variables> = {
  sessionId: string;
  mutationFn: (variables: Variables) => ResultAsync<MafiaGameProjection, GameSessionApiError>;
  onRateLimited?: (retryAfterMs: number) => void;
  onSuccess?: (projection: MafiaGameProjection) => void;
};

export function gameSessionMutationOptions<Variables>({
  sessionId,
  mutationFn,
  onRateLimited,
  onSuccess,
}: GameSessionMutationConfig<Variables>) {
  return mutationOptions({
    mutationFn: (variables: Variables) => unwrapGameSessionResult(mutationFn(variables)),
    onSuccess: (projection, _variables, _onMutateResult, context) => {
      updateGameSessionSnapshot(context.client, sessionId, projection);
      onSuccess?.(projection);
    },
    onError: (error) => {
      if (isGameSessionApiError(error) && error.type === 'rate-limited') {
        onRateLimited?.(error.retryAfterMs);
      }
    },
    meta: { sessionId },
  });
}

export function updateGameSessionSnapshot(
  queryClient: QueryClient,
  sessionId: string,
  projection: MafiaGameProjection,
) {
  queryClient.setQueryData(gameSessionSnapshotOptions(sessionId).queryKey, projection);
}

async function unwrapGameSessionResult(
  result: ResultAsync<MafiaGameProjection, GameSessionApiError>,
) {
  return result.match(
    (projection) => projection,
    (error) => {
      throw error;
    },
  );
}
