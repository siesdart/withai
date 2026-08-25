import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getGameSessionSnapshot, isUnavailableGameSession } from '@/lib/game-session-api';

export function gameSessionProjectionQueryKey(sessionId: string | undefined) {
  return ['game-session', sessionId] as const;
}

export function useGameSessionProjection(sessionId: string | undefined) {
  const sessionQuery = useQuery({
    queryKey: gameSessionProjectionQueryKey(sessionId),
    queryFn: () => getGameSessionSnapshot(sessionId!),
    enabled: Boolean(sessionId),
  });

  const { refetch } = sessionQuery;
  const retrySnapshot = useCallback(() => {
    void refetch();
  }, [refetch]);

  const isUnavailable = sessionQuery.isError && isUnavailableGameSession(sessionQuery.error);

  return {
    isFetching: sessionQuery.isFetching,
    isError: sessionQuery.isError,
    isUnavailable,
    projection: sessionQuery.data,
    retrySnapshot,
  };
}
