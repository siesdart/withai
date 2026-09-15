import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { isUnavailableGameSession } from '@/features/mafia-session/api/error';
import { ControlRoom } from '@/features/mafia-session/components/control-room/control-room';
import { ControlRoomError } from '@/features/mafia-session/components/control-room/control-room-error';
import { ControlRoomLoading } from '@/features/mafia-session/components/control-room/control-room-loading';
import { gameSessionSnapshotOptions } from '@/features/mafia-session/hooks/options/game-session-snapshot-options';
import { useGameSessionStore } from '@/features/mafia-session/store/game-session';

export const Route = createFileRoute('/mafia')({
  beforeLoad: (): { sessionId: string } => {
    const { sessionId } = useGameSessionStore.getState();
    if (sessionId) {
      return { sessionId };
    }
    throw Route.redirect({ to: '/' });
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

    if (isUnavailableGameSession(error)) {
      useGameSessionStore.getState().clearSession();
      throw Route.redirect({ to: '/' });
    }

    return <ControlRoomError onRetry={onRetry} />;
  },
  pendingComponent: ControlRoomLoading,
});
