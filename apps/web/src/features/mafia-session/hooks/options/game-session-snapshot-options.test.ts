import type { MafiaGameProjection } from '@repo/api/client';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { gameSessionSnapshotQueryKey } from './game-session-snapshot-options';

function projection(sessionId: string, eventId: number): MafiaGameProjection {
  return {
    eventId,
    sessionId,
    timeline: [],
    public: {
      dayNumber: 1,
      phase: 'discussion',
      phaseDeadline: '2026-08-27T00:02:00.000Z',
      participants: [],
      nominatedParticipantId: undefined,
      completedRecords: { voteRecords: [], nightActionRecords: [] },
    },
    personal: {
      participantId: 'participant-1',
      role: 'Citizen',
      allegiance: 'Citizen',
      vote: undefined,
      nightAction: undefined,
      knownRoles: [],
    },
  };
}

describe('removeGameSessionSnapshot', () => {
  it('removes the previous session before a new lower-event snapshot is loaded', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(gameSessionSnapshotQueryKey, projection('old-session', 9));
    queryClient.removeQueries({ queryKey: gameSessionSnapshotQueryKey, exact: true });
    queryClient.setQueryData(gameSessionSnapshotQueryKey, projection('new-session', 1));

    expect(queryClient.getQueryData(gameSessionSnapshotQueryKey)).toEqual(
      projection('new-session', 1),
    );
  });
});
