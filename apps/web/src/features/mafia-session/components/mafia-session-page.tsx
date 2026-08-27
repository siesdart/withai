import { useGameSessionSnapshot } from '../hooks/use-game-session-snapshot';
import { useGameSessionSubscription } from '../hooks/use-game-session-subscription';
import { usePublicSpeech } from '../hooks/use-public-speech';
import { ControlRoom } from './control-room';

export function MafiaSessionPage({ sessionId }: { sessionId: string }) {
  const { snapshot } = useGameSessionSnapshot(sessionId);
  const { isReconnecting } = useGameSessionSubscription(sessionId);
  const publicSpeech = usePublicSpeech(sessionId);

  return (
    <ControlRoom isReconnecting={isReconnecting} publicSpeech={publicSpeech} snapshot={snapshot} />
  );
}
