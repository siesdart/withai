import { useQuery } from '@tanstack/react-query';

import { getGameSessionSnapshot } from '@/lib/game-session-api';

export function gameSessionProjectionQueryKey(sessionId: string | undefined) {
  return ['game-session', sessionId] as const;
}

export function useGameSessionProjection(sessionId: string | undefined) {
  return useQuery({
    queryKey: gameSessionProjectionQueryKey(sessionId),
    queryFn: () => getGameSessionSnapshot(sessionId!),
    enabled: Boolean(sessionId),
  });
}
