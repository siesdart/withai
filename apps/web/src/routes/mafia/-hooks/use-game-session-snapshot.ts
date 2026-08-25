import { useSuspenseQuery } from '@tanstack/react-query';

import { getGameSessionSnapshot, isUnavailableGameSession } from '@/lib/game-session-api';

export function gameSessionSnapshotQueryKey(sessionId: string) {
  return ['game-session', sessionId] as const;
}

export function useGameSessionSnapshot(sessionId: string) {
  const query = useSuspenseQuery({
    queryKey: gameSessionSnapshotQueryKey(sessionId),
    queryFn: () => getGameSessionSnapshot(sessionId),
    retry: (failureCount, error) => {
      if (isUnavailableGameSession(error)) {
        return false;
      }
      return failureCount < 3;
    },
  });

  return { snapshot: query.data };
}
