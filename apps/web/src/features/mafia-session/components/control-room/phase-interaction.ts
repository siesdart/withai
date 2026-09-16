import type { MafiaGameProjection } from '@repo/mafia/client';
import { find } from 'remeda';
import { match } from 'ts-pattern';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';

export type PhasePanel =
  | { type: 'completed' }
  | { type: 'observer' }
  | {
      type: 'discussion';
      disabled: boolean;
      phaseDeadline: string;
      sessionId: string;
      gameAction: UseGameActionResult;
    }
  | { type: 'nomination' }
  | {
      type: 'final-defence';
      disabled: boolean;
      isCurrentParticipantNominated: boolean;
      nominatedParticipantName: string | undefined;
      gameAction: UseGameActionResult;
    }
  | {
      type: 'verdict';
      disabled: boolean;
      nominatedParticipantName: string | undefined;
      personalVote: MafiaGameProjection['personal']['vote'];
      gameAction: UseGameActionResult;
    }
  | {
      type: 'night';
      role: MafiaGameProjection['personal']['role'];
      disabled: boolean;
      gameAction: UseGameActionResult;
    };

export type ParticipantSelection = {
  actionLabel: string;
  disabled: boolean;
  onSelect: (participantId: string) => void;
  selectedParticipantId: string | undefined;
};

export type PhaseInteraction = {
  panel: PhasePanel;
  participantSelection: ParticipantSelection | undefined;
};

type CreatePhaseInteractionOptions = {
  snapshot: MafiaGameProjection;
  isPhaseExpired: boolean;
  gameAction: UseGameActionResult;
};

export function createPhaseInteraction({
  snapshot,
  isPhaseExpired,
  gameAction,
}: CreatePhaseInteractionOptions): PhaseInteraction {
  const currentParticipantAlive = Boolean(
    find(
      snapshot.public.participants,
      (participant) => participant.id === snapshot.personal.participantId && participant.alive,
    ),
  );

  if (snapshot.public.phase === 'completed') {
    return { panel: { type: 'completed' }, participantSelection: undefined };
  }

  if (!currentParticipantAlive) {
    return { panel: { type: 'observer' }, participantSelection: undefined };
  }

  const disabled = gameAction.isSubmissionBlocked || isPhaseExpired;
  const nominatedParticipantName = find(
    snapshot.public.participants,
    (participant) => participant.id === snapshot.public.nominatedParticipantId,
  )?.name;

  return match({ phase: snapshot.public.phase, role: snapshot.personal.role })
    .with({ phase: 'discussion' }, () => ({
      panel: {
        type: 'discussion' as const,
        disabled,
        phaseDeadline: snapshot.public.phaseDeadline,
        sessionId: snapshot.sessionId,
        gameAction,
      },
      participantSelection: undefined,
    }))
    .with({ phase: 'nomination' }, () => ({
      panel: { type: 'nomination' as const },
      participantSelection: {
        actionLabel: 'Nominate',
        disabled,
        onSelect: (targetParticipantId: string) =>
          gameAction.submit({ type: 'nomination', targetParticipantId }),
        selectedParticipantId:
          snapshot.personal.vote?.phase === 'nomination'
            ? snapshot.personal.vote.targetParticipantId
            : undefined,
      },
    }))
    .with({ phase: 'final-defence' }, () => ({
      panel: {
        type: 'final-defence' as const,
        disabled,
        isCurrentParticipantNominated:
          snapshot.public.nominatedParticipantId === snapshot.personal.participantId,
        nominatedParticipantName,
        gameAction,
      },
      participantSelection: undefined,
    }))
    .with({ phase: 'verdict' }, () => ({
      panel: {
        type: 'verdict' as const,
        disabled,
        nominatedParticipantName,
        personalVote: snapshot.personal.vote,
        gameAction,
      },
      participantSelection: undefined,
    }))
    .with({ phase: 'night', role: 'Mafia' }, () =>
      nightInteraction('Mafia', snapshot, disabled, gameAction),
    )
    .with({ phase: 'night', role: 'Doctor' }, () =>
      nightInteraction('Doctor', snapshot, disabled, gameAction),
    )
    .with({ phase: 'night', role: 'Police' }, () =>
      nightInteraction(
        'Police',
        snapshot,
        disabled || snapshot.personal.nightAction !== undefined,
        gameAction,
      ),
    )
    .with({ phase: 'night', role: 'Citizen' }, () => ({
      panel: { type: 'night' as const, role: 'Citizen' as const, disabled, gameAction },
      participantSelection: undefined,
    }))
    .exhaustive();
}

function nightInteraction(
  role: Extract<MafiaGameProjection['personal']['role'], 'Mafia' | 'Doctor' | 'Police'>,
  snapshot: MafiaGameProjection,
  disabled: boolean,
  gameAction: UseGameActionResult,
): PhaseInteraction {
  return {
    panel: { type: 'night', role, disabled, gameAction },
    participantSelection: {
      actionLabel: nightActionLabel(role),
      disabled,
      onSelect: (targetParticipantId: string) =>
        gameAction.submit(nightAction(role, targetParticipantId)),
      selectedParticipantId: snapshot.personal.nightAction?.targetParticipantId,
    },
  };
}

function nightActionLabel(
  role: Extract<MafiaGameProjection['personal']['role'], 'Mafia' | 'Doctor' | 'Police'>,
) {
  return match(role)
    .with('Mafia', () => 'Target' as const)
    .with('Doctor', () => 'Protect' as const)
    .with('Police', () => 'Investigate' as const)
    .exhaustive();
}

function nightAction(
  role: Extract<MafiaGameProjection['personal']['role'], 'Mafia' | 'Doctor' | 'Police'>,
  targetParticipantId: string,
) {
  return match(role)
    .with('Mafia', () => ({ type: 'mafia-target' as const, targetParticipantId }))
    .with('Doctor', () => ({ type: 'doctor-protection' as const, targetParticipantId }))
    .with('Police', () => ({ type: 'police-investigation' as const, targetParticipantId }))
    .exhaustive();
}
