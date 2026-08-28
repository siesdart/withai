import { describe, expect, it } from '@jest/globals';
import type { MafiaAgentSpeechContext } from '@repo/mafia';

import { DeterministicAgentSpeechGateway } from '../src/game-sessions/agent-speech.gateway';

describe('DeterministicAgentSpeechGateway', () => {
  it('always supplies an opening and follow-up for an Agent Final Defence', () => {
    const context: MafiaAgentSpeechContext = {
      participant: { id: 'participant-2', name: 'Mina' },
      persona: 'Mina is observant and concise.',
      public: {
        dayNumber: 1,
        phase: 'final-defence',
        phaseDeadline: '2026-08-28T00:00:45.000Z',
        participants: [],
        nominatedParticipantId: 'participant-2',
        voteStatus: undefined,
        timeline: [],
        completedVoteRecords: [],
      },
      personal: {
        participantId: 'participant-2',
        role: 'Citizen',
        allegiance: 'Citizen',
        vote: undefined,
      },
    };

    expect(new DeterministicAgentSpeechGateway().decideFinalDefence(context)).toEqual({
      opening:
        'Mina: As someone observant and concise., I ask you to judge the evidence carefully.',
      followUp: 'Mina: My position has not changed; please weigh the facts.',
    });
  });
});
