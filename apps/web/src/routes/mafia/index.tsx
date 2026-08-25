import { createFileRoute } from '@tanstack/react-router';

import { ControlRoom } from '@/routes/mafia/-components/control-room';
import { ControlRoomError } from '@/routes/mafia/-components/control-room-error';
import { ControlRoomLoading } from '@/routes/mafia/-components/control-room-loading';
import { useGameSessionProjection } from '@/routes/mafia/-hooks/use-game-session-projection';
import { useGameSessionSubscription } from '@/routes/mafia/-hooks/use-game-session-subscription';
import { useMafiaGameSession } from '@/routes/mafia/-hooks/use-mafia-game-session';

export const Route = createFileRoute('/mafia/')({
  component: MafiaControlRoom,
});

function MafiaControlRoom() {
  const { sessionId, retry, startNewGame, isCreating, hasCreationError } = useMafiaGameSession();
  const { isFetching, isUnavailable, isError, projection, retrySnapshot } =
    useGameSessionProjection(sessionId);
  const { isReconnecting } = useGameSessionSubscription(sessionId);

  if (isCreating || isFetching) {
    return <ControlRoomLoading />;
  }

  if (hasCreationError) {
    return <ControlRoomError onRetry={retry} />;
  }

  if (isUnavailable) {
    return (
      <ControlRoomError
        onStartNewGame={startNewGame}
        title="This Game Session is no longer available."
        description="Start a new Game Session when you are ready."
      />
    );
  }

  if (isError || !projection) {
    return <ControlRoomError onRetry={retrySnapshot} />;
  }

  return <ControlRoom isReconnecting={isReconnecting} projection={projection} />;
}
