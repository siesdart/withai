import { describe, expect, it } from 'vitest';

import { parseMafiaGameProjection } from './entity';

describe('parseMafiaGameProjection', () => {
  it('accepts JSON projections whose undefined fields are omitted', () => {
    const result = parseMafiaGameProjection(
      JSON.stringify({
        eventId: 1,
        sessionId: '2536c51f-496b-41af-8934-446c2eb85374',
        public: {
          dayNumber: 1,
          phase: 'day-discussion',
          phaseDeadline: '2026-08-28T11:32:16.541Z',
          participants: [{ id: 'participant-1', name: 'You', alive: true }],
          timeline: [
            {
              id: 'timeline-1',
              type: 'record',
              outcome: { id: 'outcome-1', type: 'day-changed', dayNumber: 1 },
            },
          ],
          completedVoteRecords: [],
        },
        personal: { participantId: 'participant-1', role: 'Mafia', allegiance: 'Mafia' },
      }),
    );

    expect(result.isOk()).toBe(true);
    if (result.isErr()) return;

    expect(result.value).toMatchObject({
      public: { nominatedParticipantId: undefined, voteStatus: undefined },
      personal: { vote: undefined },
    });
  });
});
