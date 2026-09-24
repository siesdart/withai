import type { MafiaGameProjection } from '@repo/api/client';
import { describe, expect, it } from 'vitest';

import { completedRecordDays } from './game-record-marker';

describe('completedRecordDays', () => {
  it('orders mixed vote and Night Action Records by Day number', () => {
    const completedRecords: MafiaGameProjection['public']['completedRecords'] = {
      voteRecords: [
        {
          id: 'vote-record-1',
          dayNumber: 3,
          phase: 'verdict',
          votes: [{ participantId: 'participant-1', vote: 'eliminate' }],
        },
        {
          id: 'vote-record-2',
          dayNumber: 1,
          phase: 'nomination',
          votes: [{ participantId: 'participant-1', targetParticipantId: 'participant-2' }],
        },
      ],
      nightActionRecords: [
        {
          id: 'night-action-record-1',
          dayNumber: 2,
          mafiaTargetParticipantId: 'participant-3',
          doctorActions: [],
          policeActions: [],
        },
        {
          id: 'night-action-record-2',
          dayNumber: 3,
          mafiaTargetParticipantId: undefined,
          doctorActions: [],
          policeActions: [],
        },
      ],
    };

    expect(completedRecordDays(completedRecords)).toEqual([1, 2, 3]);
  });
});
