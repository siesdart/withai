import type { MafiaGameProjection, GameSessionApiError } from '@repo/api/client';
import { mutationOptions, type QueryClient } from '@tanstack/react-query';
import type { ResultAsync } from 'neverthrow';

import { isGameSessionApiError } from '../../api/error';
import { gameSessionSnapshotOptions } from './game-session-snapshot-options';

type GameSessionMutationConfig<Variables> = {
  mutationFn: (variables: Variables) => ResultAsync<MafiaGameProjection, GameSessionApiError>;
  onRateLimited?: (retryAfterMs: number) => void;
  onSuccess?: (projection: MafiaGameProjection) => void;
};

export function gameSessionMutationOptions<Variables>({
  mutationFn,
  onRateLimited,
  onSuccess,
}: GameSessionMutationConfig<Variables>) {
  return mutationOptions({
    mutationFn: (variables: Variables) => unwrapGameSessionResult(mutationFn(variables)),
    onSuccess: (projection, _variables, _onMutateResult, context) => {
      updateGameSessionSnapshot(context.client, projection);
      onSuccess?.(projection);
    },
    onError: (error) => {
      if (isGameSessionApiError(error) && error.type === 'rate-limited') {
        onRateLimited?.(error.retryAfterMs);
      }
    },
  });
}

export function updateGameSessionSnapshot(
  queryClient: QueryClient,
  projection: MafiaGameProjection,
) {
  queryClient.setQueryData(gameSessionSnapshotOptions().queryKey, projection);
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
