import { useGameSessionSnapshot } from '../hooks/use-game-session-snapshot';
import { useGameSessionSubscription } from '../hooks/use-game-session-subscription';
import { ControlRoom } from './control-room';

export function MafiaSessionPage({ sessionId }: { sessionId: string }) {
  const { snapshot } = useGameSessionSnapshot(sessionId);
  const { isReconnecting } = useGameSessionSubscription(sessionId);

  return <ControlRoom isReconnecting={isReconnecting} snapshot={snapshot} />;
}
