import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { createMafiaGameSession } from '@/lib/api/game-session/api';
import { isUnavailableGameSession } from '@/lib/api/game-session/error';
import { useGameSessionStore } from '@/lib/stores/game-session';
import { ControlRoom } from '@/routes/mafia/-components/control-room';
import { ControlRoomError } from '@/routes/mafia/-components/control-room-error';
import { ControlRoomLoading } from '@/routes/mafia/-components/control-room-loading';
import { gameSessionSnapshotOptions } from '@/routes/mafia/-hooks/use-game-session-snapshot';
import { useGameSessionSnapshot } from '@/routes/mafia/-hooks/use-game-session-snapshot';
import { useGameSessionSubscription } from '@/routes/mafia/-hooks/use-game-session-subscription';

export const Route = createFileRoute('/mafia/')({
  beforeLoad: async (): Promise<{ sessionId: string }> => {
    const { sessionId, ensureCreationKey, setSessionId } = useGameSessionStore.getState();
    if (sessionId) {
      return { sessionId };
    }

    const result = await createMafiaGameSession(ensureCreationKey());
    return result.match(
      (projection) => {
        setSessionId(projection.sessionId);
        return { sessionId: projection.sessionId };
      },
      (error) => {
        throw error;
      },
    );
  },
  loader: ({ context }) => {
    const { sessionId } = useGameSessionStore.getState();
    if (sessionId) {
      void context.queryClient.query({
        ...gameSessionSnapshotOptions(sessionId),
        staleTime: 'static',
      });
    }
  },
  component: () => {
    const { sessionId } = Route.useRouteContext();
    return <MafiaControlRoom sessionId={sessionId} />;
  },
  errorComponent: ({ error }) => {
    const router = useRouter();
    const queryClient = useQueryClient();
    const onRetry = useCallback(() => {
      const { sessionId } = useGameSessionStore.getState();
      if (sessionId) {
        void queryClient.invalidateQueries({
          queryKey: gameSessionSnapshotOptions(sessionId).queryKey,
        });
      }
      void router.invalidate();
    }, [queryClient, router]);
    const onStartNewGame = useCallback(() => {
      useGameSessionStore.getState().clearSession();
      void router.invalidate();
    }, [router]);

    if (isUnavailableGameSession(error)) {
      return (
        <ControlRoomError
          onStartNewGame={onStartNewGame}
          title="This Game Session is no longer available."
          description="Start a new Game Session when you are ready."
        />
      );
    }

    return <ControlRoomError onRetry={onRetry} />;
  },
  pendingComponent: ControlRoomLoading,
});

function MafiaControlRoom({ sessionId }: { sessionId: string }) {
  const { snapshot } = useGameSessionSnapshot(sessionId);
  const { isReconnecting } = useGameSessionSubscription(sessionId);

  return <ControlRoom isReconnecting={isReconnecting} snapshot={snapshot} />;
}
