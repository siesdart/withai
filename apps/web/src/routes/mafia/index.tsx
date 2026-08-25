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
  const { sessionId, retry, isCreating, hasCreationError } = useMafiaGameSession();
  const sessionQuery = useGameSessionProjection(sessionId);
  useGameSessionSubscription(sessionId);

  if (isCreating || sessionQuery.fetchStatus === 'fetching') {
    return <ControlRoomLoading />;
  }

  if (hasCreationError || sessionQuery.isError || !sessionQuery.data) {
    return <ControlRoomError onRetry={retry} />;
  }

  return <ControlRoom projection={sessionQuery.data} />;
}
