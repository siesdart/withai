import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', () => ({ randomInt: () => 0 }));

import {
  rememberAllegianceEstimates,
  type AgentMind,
} from '../../../src/game-sessions/agents/agent-mind.js';

describe('Agent Mind', () => {
  it('keeps estimates only for Participants whose allegiance is still unknown', () => {
    const mind: AgentMind = {
      persona: 'Joon is observant and concise.',
      memory: {
        revision: 2,
        allegianceEstimates: [
          { participantId: 'mina', mafiaProbability: 72, basis: 'Unsupported nomination.' },
          { participantId: 'known-mafia', mafiaProbability: 95, basis: 'Old estimate.' },
        ],
        strategy: 'Ask for a concrete basis before supporting a nomination.',
      },
    };

    rememberAllegianceEstimates(
      mind,
      {
        participant: { id: 'joon', name: 'Joon' },
        persona: mind.persona,
        timeline: [],
        public: {
          dayNumber: 1,
          phase: 'discussion',
          phaseDeadline: '2026-09-13T00:00:00.000Z',
          participants: [
            { id: 'joon', name: 'Joon', alive: true },
            { id: 'mina', name: 'Mina', alive: true },
            { id: 'known-mafia', name: 'Known Mafia', alive: true },
          ],
          nominatedParticipantId: undefined,
          completedRecords: { voteRecords: [], nightActionRecords: [] },
        },
        personal: {
          participantId: 'joon',
          role: 'Citizen',
          allegiance: 'Citizen',
          vote: undefined,
          nightAction: undefined,
          knownRoles: [{ participantId: 'known-mafia', role: 'Mafia' }],
        },
      },
      [{ participantId: 'mina', mafiaProbability: 65, basis: 'Avoided a direct answer.' }],
      'Press Mina for a direct answer before deciding on the nomination.',
    );

    expect(mind.memory.allegianceEstimates).toEqual([
      { participantId: 'mina', mafiaProbability: 65, basis: 'Avoided a direct answer.' },
    ]);
    expect(mind.memory.strategy).toBe(
      'Press Mina for a direct answer before deciding on the nomination.',
    );
  });

  it('keeps a known Citizen allegiance estimate to infer the specific Citizen role', () => {
    const mind: AgentMind = {
      persona: 'Joon is observant and concise.',
      memory: {
        revision: 2,
        allegianceEstimates: [
          {
            participantId: 'revealed-citizen',
            mafiaProbability: 48,
            roleProbabilities: {
              policeProbability: 20,
              doctorProbability: 60,
            },
            basis: 'Old estimate.',
          },
        ],
        strategy: 'Watch the revealed Citizen for a role claim.',
      },
    };

    rememberAllegianceEstimates(
      mind,
      {
        participant: { id: 'joon', name: 'Joon' },
        persona: mind.persona,
        timeline: [],
        public: {
          dayNumber: 1,
          phase: 'discussion',
          phaseDeadline: '2026-09-13T00:00:00.000Z',
          participants: [
            { id: 'joon', name: 'Joon', alive: true },
            { id: 'revealed-citizen', name: 'Revealed Citizen', alive: true },
          ],
          nominatedParticipantId: undefined,
          completedRecords: { voteRecords: [], nightActionRecords: [] },
        },
        personal: {
          participantId: 'joon',
          role: 'Citizen',
          allegiance: 'Citizen',
          vote: undefined,
          nightAction: undefined,
          knownRoles: [{ participantId: 'revealed-citizen', role: 'Citizen' }],
        },
      },
      undefined,
    );

    expect(mind.memory.allegianceEstimates).toEqual([
      {
        participantId: 'revealed-citizen',
        mafiaProbability: 0,
        roleProbabilities: {
          policeProbability: 20,
          doctorProbability: 60,
        },
        basis: 'Old estimate.',
      },
    ]);
  });
});
