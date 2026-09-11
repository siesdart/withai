import { describe, expect, it } from '@jest/globals';
import type { MafiaAgentSpeechContext } from '@repo/mafia';

import { DeterministicAgentDecisionGateway } from '../../../src/game-sessions/agent-decision.gateway';

describe('DeterministicAgentDecisionGateway', () => {
  it('always supplies an opening and follow-up for an Agent Final Defence', () => {
    const context: MafiaAgentSpeechContext = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      timeline: [],
      public: {
        dayNumber: 1,
        phase: 'final-defence',
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: 'participant-2',
        completedRecords: { voteRecords: [], nightActionRecords: [] },
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen',
        allegiance: 'Citizen',
        vote: undefined,
        nightAction: undefined,
        knownRoles: [],
      },
    };

    expect(new DeterministicAgentDecisionGateway().decideFinalDefence(context)).toEqual({
      opening: 'As someone observant and concise., I ask you to judge the evidence carefully.',
      followUp: 'My position has not changed; please weigh the facts.',
    });
  });
});
