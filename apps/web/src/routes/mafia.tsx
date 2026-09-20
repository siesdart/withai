import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Navigate, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { isUnavailableGameSession } from '@/features/mafia-session/api/error';
import { getHolderToken } from '@/features/mafia-session/api/holder-token';
import { ControlRoom } from '@/features/mafia-session/components/control-room/control-room';
import { ControlRoomError } from '@/features/mafia-session/components/control-room/control-room-error';
import { ControlRoomLoading } from '@/features/mafia-session/components/control-room/control-room-loading';
import { gameSessionSnapshotOptions } from '@/features/mafia-session/hooks/options/game-session-snapshot-options';
import { useGameSessionStore } from '@/features/mafia-session/store/game-session';

export const Route = createFileRoute('/mafia')({
  beforeLoad: () => {
    if (getHolderToken()) {
      return;
    }
    throw Route.redirect({ to: '/' });
  },
  loader: ({ context }) =>
    context.queryClient.query({
      ...gameSessionSnapshotOptions(),
      staleTime: 'static',
    }),
  component: ControlRoom,
  errorComponent: ({ error }) => {
    const router = useRouter();
    const queryClient = useQueryClient();
    const onRetry = useCallback(() => {
      queryClient.removeQueries({ queryKey: gameSessionSnapshotOptions().queryKey });
      void router.invalidate();
    }, [queryClient, router]);

    if (isUnavailableGameSession(error)) {
      useGameSessionStore.getState().clearSession();
      return <Navigate to="/" replace />;
    }

    return <ControlRoomError onRetry={onRetry} />;
  },
  pendingComponent: ControlRoomLoading,
});
