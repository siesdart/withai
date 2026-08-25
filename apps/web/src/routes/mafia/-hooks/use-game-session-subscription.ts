import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { isUnavailableGameSession, subscribeToGameSession } from '@/lib/game-session-api';

import { gameSessionSnapshotQueryKey } from './use-game-session-snapshot';

export function useGameSessionSubscription(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }

    const abortController = new AbortController();
    let lastEventId: string | undefined;
    let retryCount = 0;

    const subscribe = async () => {
      while (!abortController.signal.aborted) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- reconnect attempts must remain ordered.
          await subscribeToGameSession(sessionId, {
            lastEventId,
            onConnected: () => {
              retryCount = 0;
              setIsReconnecting(false);
              void queryClient.invalidateQueries({
                queryKey: gameSessionSnapshotQueryKey(sessionId),
              });
            },
            onProjection: (projection, eventId) => {
              lastEventId = eventId;
              queryClient.setQueryData(gameSessionSnapshotQueryKey(sessionId), projection);
            },
            signal: abortController.signal,
          });
        } catch (error) {
          if (abortController.signal.aborted) {
            return;
          }
          if (isUnavailableGameSession(error)) {
            void queryClient.invalidateQueries({
              queryKey: gameSessionSnapshotQueryKey(sessionId),
            });
            return;
          }
        }

        retryCount += 1;
        setIsReconnecting(retryCount >= 3);
        const delayMs = Math.min(1000 * 2 ** (retryCount - 1), 30_000);
        // oxlint-disable-next-line no-await-in-loop -- wait before the next ordered reconnect attempt.
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, delayMs);
        });
      }
    };

    void subscribe();

    return () => {
      abortController.abort();
    };
  }, [queryClient, sessionId]);

  return { isReconnecting };
}
