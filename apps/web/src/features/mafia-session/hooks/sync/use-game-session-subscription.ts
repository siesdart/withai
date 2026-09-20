import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { match } from 'ts-pattern';

import { MafiaGameSessionClient } from '../../api/client';
import { updateGameSessionSnapshot } from '../options/game-session-mutation-options';
import { gameSessionSnapshotOptions } from '../options/game-session-snapshot-options';

export function useGameSessionSubscription() {
  const queryClient = useQueryClient();
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    const client = new MafiaGameSessionClient();
    const abortController = new AbortController();
    let lastEventId: string | undefined;
    let highestProjectionEventId = -1;
    let retryCount = 0;
    let receivedCompletedProjection = false;

    const subscribe = async () => {
      while (!abortController.signal.aborted) {
        // oxlint-disable-next-line no-await-in-loop -- reconnect attempts must remain ordered.
        const result = await client.subscribe({
          lastEventId,
          onConnected: () => {
            retryCount = 0;
            setIsReconnecting(false);
            void queryClient.invalidateQueries(gameSessionSnapshotOptions());
          },
          onProjection: (projection, eventId) => {
            if (projection.eventId <= highestProjectionEventId) return;
            highestProjectionEventId = projection.eventId;
            lastEventId = eventId || String(projection.eventId);
            receivedCompletedProjection ||= projection.public.phase === 'completed';
            updateGameSessionSnapshot(queryClient, projection);
          },
          signal: abortController.signal,
        });

        const shouldReconnect = result.match(
          () => !receivedCompletedProjection,
          (error) =>
            match(error)
              .with({ type: 'aborted' }, () => false)
              .with({ type: 'holder-token-invalid' }, () => false)
              .with({ type: 'unavailable' }, () => {
                void queryClient.invalidateQueries(gameSessionSnapshotOptions());
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
  }, [queryClient]);

  return { isReconnecting };
}
