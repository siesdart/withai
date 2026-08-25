import { useSuspenseQuery } from '@tanstack/react-query';

import { getGameSessionSnapshot } from '@/lib/api/game-session/api';
import { isUnavailableGameSession } from '@/lib/api/game-session/error';

export function gameSessionSnapshotQueryKey(sessionId: string) {
  return ['game-session', sessionId] as const;
}

export function useGameSessionSnapshot(sessionId: string) {
  const query = useSuspenseQuery({
    queryKey: gameSessionSnapshotQueryKey(sessionId),
    queryFn: async () => {
      const result = await getGameSessionSnapshot(sessionId);
      return result.match(
        (projection) => projection,
        (error) => {
          throw error;
        },
      );
    },
    retry: (failureCount, error) => {
      if (isUnavailableGameSession(error)) {
        return false;
      }
      return failureCount < 3;
    },
  });

  return { snapshot: query.data };
}
