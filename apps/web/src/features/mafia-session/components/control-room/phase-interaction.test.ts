import type { MafiaGameProjection } from '@repo/mafia/client';
import { describe, expect, it, vi } from 'vitest';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { createPhaseInteraction } from './phase-interaction';

const participantId = 'participant-you';
const targetParticipantId = 'participant-target';

function projection(): MafiaGameProjection {
  return {
    eventId: 1,
    sessionId: 'session-1',
    timeline: [],
    public: {
      dayNumber: 1,
      phase: 'discussion',
      phaseDeadline: '2026-08-29T00:02:00.000Z',
      participants: [
        { id: participantId, name: 'You', alive: true },
        { id: targetParticipantId, name: 'Mina', alive: true },
      ],
      nominatedParticipantId: undefined,
      completedRecords: { voteRecords: [], nightActionRecords: [] },
    },
    personal: {
      participantId,
      role: 'Citizen',
      allegiance: 'Citizen',
      vote: undefined,
      nightAction: undefined,
      knownRoles: [],
    },
  };
}

function gameAction(): UseGameActionResult {
  return {
    draft: undefined,
    error: undefined,
    isSubmissionBlocked: false,
    retryAfterSeconds: undefined,
    setDraft: vi.fn(),
    submit: vi.fn(),
    submitDraft: vi.fn(),
  };
}

function interactionFor(snapshot: MafiaGameProjection, action: UseGameActionResult = gameAction()) {
  return createPhaseInteraction({ snapshot, isPhaseExpired: false, gameAction: action });
}

describe('createPhaseInteraction', () => {
  it('provides only discussion controls during discussion', () => {
    const interaction = interactionFor(projection());

    expect(interaction.panel).toMatchObject({
      type: 'discussion',
      disabled: false,
      phaseDeadline: '2026-08-29T00:02:00.000Z',
    });
    expect(interaction.participantSelection).toBeUndefined();
  });

  it('connects nomination selection to the nomination action', () => {
    const snapshot = projection();
    snapshot.public.phase = 'nomination';
    const action = gameAction();
    const interaction = interactionFor(snapshot, action);

    expect(interaction.panel).toMatchObject({ type: 'nomination' });
    expect(interaction.participantSelection?.actionLabel).toBe('Nominate');
    interaction.participantSelection?.onSelect(targetParticipantId);
    expect(action.submit).toHaveBeenCalledWith({ type: 'nomination', targetParticipantId });
  });

  it('keeps final-defence ownership with the nominated participant', () => {
    const snapshot = projection();
    snapshot.public.phase = 'final-defence';
    snapshot.public.nominatedParticipantId = participantId;
    const interaction = interactionFor(snapshot);

    expect(interaction.panel).toMatchObject({
      type: 'final-defence',
      isCurrentParticipantNominated: true,
      nominatedParticipantName: 'You',
    });
    expect(interaction.participantSelection).toBeUndefined();
  });

  it('connects each actionable night role to its semantic target action', () => {
    const roles = [
      ['Mafia', 'Target', 'mafia-target'],
      ['Doctor', 'Protect', 'doctor-protection'],
      ['Detective', 'Investigate', 'detective-investigation'],
    ] as const;

    for (const [role, actionLabel, type] of roles) {
      const snapshot = projection();
      snapshot.public.phase = 'night';
      snapshot.personal.role = role;
      const action = gameAction();
      const interaction = interactionFor(snapshot, action);

      expect(interaction.panel).toMatchObject({ type: 'night', role });
      expect(interaction.participantSelection?.actionLabel).toBe(actionLabel);
      interaction.participantSelection?.onSelect(targetParticipantId);
      expect(action.submit).toHaveBeenCalledWith({ type, targetParticipantId });
    }
  });

  it('removes controls when the player is dead or the game is complete', () => {
    const deadPlayerSnapshot = projection();
    deadPlayerSnapshot.public.participants[0].alive = false;
    const completedSnapshot = projection();
    completedSnapshot.public.phase = 'completed';

    expect(interactionFor(deadPlayerSnapshot)).toEqual({
      panel: { type: 'observer' },
      participantSelection: undefined,
    });
    expect(interactionFor(completedSnapshot)).toEqual({
      panel: { type: 'completed' },
      participantSelection: undefined,
    });
  });
});
