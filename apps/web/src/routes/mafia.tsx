import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { MafiaGameSessionClient } from '@/features/mafia-session/api/client';
import { isUnavailableGameSession } from '@/features/mafia-session/api/error';
import { ControlRoom } from '@/features/mafia-session/components/control-room/control-room';
import { ControlRoomError } from '@/features/mafia-session/components/control-room/control-room-error';
import { ControlRoomLoading } from '@/features/mafia-session/components/control-room/control-room-loading';
import { gameSessionSnapshotOptions } from '@/features/mafia-session/hooks/use-game-session-snapshot';
import { useGameSessionStore } from '@/features/mafia-session/store/game-session';

export const Route = createFileRoute('/mafia')({
  beforeLoad: async (): Promise<{ sessionId: string }> => {
    const { sessionId, ensureCreationKey, setSessionId } = useGameSessionStore.getState();
    if (sessionId) {
      return { sessionId };
    }

    const result = await MafiaGameSessionClient.createSession(ensureCreationKey());
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
  loader: ({ context }) =>
    context.queryClient.query({
      ...gameSessionSnapshotOptions(context.sessionId),
      staleTime: 'static',
    }),
  component: () => {
    const { sessionId } = Route.useRouteContext();
    return <ControlRoom sessionId={sessionId} />;
  },
  errorComponent: ({ error }) => {
    const router = useRouter();
    const queryClient = useQueryClient();
    const onRetry = useCallback(() => {
      const { sessionId } = useGameSessionStore.getState();
      if (sessionId) {
        queryClient.removeQueries({
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
