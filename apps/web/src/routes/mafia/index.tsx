import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

import { createMafiaGameSession, isUnavailableGameSession } from '@/lib/game-session-api';
import { useGameSessionStore } from '@/lib/game-session-store';
import { ControlRoom } from '@/routes/mafia/-components/control-room';
import { ControlRoomError } from '@/routes/mafia/-components/control-room-error';
import { ControlRoomLoading } from '@/routes/mafia/-components/control-room-loading';
import { useGameSessionSnapshot } from '@/routes/mafia/-hooks/use-game-session-snapshot';
import { useGameSessionSubscription } from '@/routes/mafia/-hooks/use-game-session-subscription';

export const Route = createFileRoute('/mafia/')({
  beforeLoad: async (): Promise<{ sessionId: string }> => {
    const { sessionId, ensureCreationKey, setSessionId } = useGameSessionStore.getState();
    if (sessionId) {
      return { sessionId };
    }

    const projection = await createMafiaGameSession(ensureCreationKey());
    setSessionId(projection.sessionId);
    return { sessionId: projection.sessionId };
  },
  component: () => {
    const { sessionId } = Route.useRouteContext();
    return <MafiaControlRoom sessionId={sessionId} />;
  },
  errorComponent: ({ error }) => {
    const router = useRouter();
    const onRetry = useCallback(() => {
      void router.invalidate();
    }, [router]);
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
