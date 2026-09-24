import type { MafiaGameProjection } from '@repo/api/client';
import { describe, expect, it } from 'vitest';

import { retainNewerProjection } from './projection-order';

function projection(eventId: number): MafiaGameProjection {
  return {
    eventId,
    sessionId: 'session-1',
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

describe('retainNewerProjection', () => {
  it('preserves a newer cached projection when a stale response arrives', () => {
    const current = projection(6);

    expect(retainNewerProjection(current, projection(2))).toBe(current);
  });

  it('accepts an incoming projection when it is newer', () => {
    const incoming = projection(6);

    expect(retainNewerProjection(projection(2), incoming)).toBe(incoming);
  });
});
