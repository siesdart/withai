import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { subscribeToGameSession } from '@/lib/game-session-api';

import { gameSessionProjectionQueryKey } from './use-game-session-projection';

export function useGameSessionSubscription(sessionId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }

    const abortController = new AbortController();
    void subscribeToGameSession(
      sessionId,
      (projection) => {
        queryClient.setQueryData(gameSessionProjectionQueryKey(sessionId), projection);
      },
      abortController.signal,
    ).catch(() => undefined);

    return () => {
      abortController.abort();
    };
  }, [queryClient, sessionId]);
}
