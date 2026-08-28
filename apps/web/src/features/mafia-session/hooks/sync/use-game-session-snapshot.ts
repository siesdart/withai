import { useSuspenseQuery } from '@tanstack/react-query';

import { gameSessionSnapshotOptions } from '../options/game-session-snapshot-options';

export function useGameSessionSnapshot(sessionId: string) {
  const query = useSuspenseQuery(gameSessionSnapshotOptions(sessionId));

  return { snapshot: query.data };
}
