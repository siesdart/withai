import type { MafiaGameProjection } from '@repo/api/client';
import { queryOptions } from '@tanstack/react-query';

import { MafiaGameSessionClient } from '../../api/client';
import { isUnavailableGameSession } from '../../api/error';
import { retainNewerProjection } from './projection-order';

export const gameSessionSnapshotQueryKey = ['game-session'] as const;

export const gameSessionSnapshotOptions = () =>
  queryOptions<MafiaGameProjection>({
    queryKey: gameSessionSnapshotQueryKey,
    queryFn: async () => {
      const client = new MafiaGameSessionClient();
      const result = await client.getSnapshot();
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
