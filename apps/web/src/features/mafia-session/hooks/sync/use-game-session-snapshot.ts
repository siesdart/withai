import { useSuspenseQuery } from '@tanstack/react-query';

import { gameSessionSnapshotOptions } from '../options/game-session-snapshot-options';

export function useGameSessionSnapshot() {
  const query = useSuspenseQuery(gameSessionSnapshotOptions());

  return { snapshot: query.data };
}
