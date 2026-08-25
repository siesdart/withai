import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

import { getGameSessionSnapshot } from '@/lib/api/game-session/api';
import { isUnavailableGameSession } from '@/lib/api/game-session/error';

export const gameSessionSnapshotOptions = (sessionId: string) =>
  queryOptions({
    queryKey: ['game-session', sessionId],
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

export function useGameSessionSnapshot(sessionId: string) {
  const query = useSuspenseQuery(gameSessionSnapshotOptions(sessionId));

  return { snapshot: query.data };
}
