import type { MafiaGameProjection } from '@repo/mafia';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

import { getGameSessionSnapshot } from '../api/api';
import { isUnavailableGameSession } from '../api/error';
import { retainNewerProjection } from './projection-order';

export const gameSessionSnapshotOptions = (sessionId: string) =>
  queryOptions<MafiaGameProjection>({
    queryKey: ['game-session', sessionId],
    queryFn: async (): Promise<MafiaGameProjection> => {
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
    structuralSharing: retainNewerProjection,
  });

export function useGameSessionSnapshot(sessionId: string) {
  const query = useSuspenseQuery(gameSessionSnapshotOptions(sessionId));

  return { snapshot: query.data };
}
