import type { MafiaGameProjection } from '@repo/mafia';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { gameSessionSnapshotOptions } from './use-game-session-snapshot';

function projection(eventId: number): MafiaGameProjection {
  return {
    eventId,
    sessionId: 'session-1',
    public: {
      dayNumber: 1,
      phase: 'day-discussion',
      phaseDeadline: '2026-08-27T00:02:00.000Z',
      participants: [],
      nominatedParticipantId: undefined,
      voteStatus: undefined,
      timeline: [],
      completedVoteRecords: [],
    },
    personal: {
      participantId: 'participant-1',
      role: 'Citizen',
      allegiance: 'Citizen',
      vote: undefined,
    },
  };
}

describe('gameSessionSnapshotOptions', () => {
  it('preserves a newer cached projection when an action response arrives late', async () => {
    const queryClient = new QueryClient();
    const options = gameSessionSnapshotOptions('session-1');
    const initial = projection(2);
    const newer = projection(6);
    const staleActionResponse = projection(2);

    await queryClient.fetchQuery({ ...options, queryFn: async () => initial });
    queryClient.setQueryData(options.queryKey, newer);
    queryClient.setQueryData(options.queryKey, staleActionResponse);

    expect(queryClient.getQueryData(options.queryKey)).toBe(newer);
    queryClient.clear();
  });
});
