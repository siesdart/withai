import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { createMafiaGameSession } from '@/features/mafia-session/api/api';
import { isUnavailableGameSession } from '@/features/mafia-session/api/error';
import { ControlRoomError } from '@/features/mafia-session/components/control-room-error';
import { ControlRoomLoading } from '@/features/mafia-session/components/control-room-loading';
import { MafiaSessionPage } from '@/features/mafia-session/components/mafia-session-page';
import { gameSessionSnapshotOptions } from '@/features/mafia-session/hooks/use-game-session-snapshot';
import { useGameSessionStore } from '@/features/mafia-session/store/game-session';

export const Route = createFileRoute('/mafia')({
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
  loader: ({ context }) =>
    context.queryClient.query({
      ...gameSessionSnapshotOptions(context.sessionId),
      staleTime: 'static',
    }),
  component: () => {
    const { sessionId } = Route.useRouteContext();
    return <MafiaSessionPage sessionId={sessionId} />;
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
