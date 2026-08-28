import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { match } from 'ts-pattern';

import { MafiaGameSessionClient } from '../../api/client';
import { updateGameSessionSnapshot } from '../options/game-session-mutation-options';
import { gameSessionSnapshotOptions } from '../options/game-session-snapshot-options';

export function useGameSessionSubscription(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }

    const client = new MafiaGameSessionClient(sessionId);
    const abortController = new AbortController();
    let lastEventId: string | undefined;
    let retryCount = 0;

    const subscribe = async () => {
      while (!abortController.signal.aborted) {
        // oxlint-disable-next-line no-await-in-loop -- reconnect attempts must remain ordered.
        const result = await client.subscribe({
          lastEventId,
          onConnected: () => {
            retryCount = 0;
            setIsReconnecting(false);
            void queryClient.invalidateQueries(gameSessionSnapshotOptions(sessionId));
          },
          onProjection: (projection, eventId) => {
            lastEventId = eventId;
            updateGameSessionSnapshot(queryClient, sessionId, projection);
          },
          signal: abortController.signal,
        });

        const shouldReconnect = result.match(
          () => true,
          (error) =>
            match(error)
              .with({ type: 'aborted' }, () => false)
              .with({ type: 'unavailable' }, () => {
                void queryClient.invalidateQueries(gameSessionSnapshotOptions(sessionId));
                return false;
              })
              .with({ type: 'action-rejected' }, () => false)
              .with({ type: 'rate-limited' }, () => false)
              .with({ type: 'invalid-event' }, () => true)
              .with({ type: 'request-failed' }, () => true)
              .exhaustive(),
        );
        if (!shouldReconnect) {
          return;
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
