import { cn } from '@repo/ui/lib/utils';
import { find } from 'remeda';
import { match } from 'ts-pattern';

import type { MafiaGameProjection } from '../../api/client';
import type { UseGameActionResult } from '../../hooks/actions/use-game-action';
import { DiscussionTimeControls } from '../game-information/discussion-time-controls';
import { FinalDefenceForm } from './final-defence-form';
import { PublicSpeechForm } from './public-speech-form';
import { VerdictControls } from './verdict-controls';

type PhaseActionPanelProps = {
  sessionId: string;
  snapshot: MafiaGameProjection;
  currentParticipantAlive: boolean;
  isPhaseExpired: boolean;
  gameAction: UseGameActionResult;
};

export function PhaseActionPanel({
  sessionId,
  snapshot,
  currentParticipantAlive,
  isPhaseExpired,
  gameAction,
}: PhaseActionPanelProps) {
  if (snapshot.public.phase === 'completed') {
    return (
      <div className="shrink-0 p-3 text-sm text-[#625e55] sm:p-5">
        You are now observing the completed game. The full vote record is available below.
      </div>
    );
  }

  if (!currentParticipantAlive) {
    return (
      <div className="shrink-0 border-t border-[#22221e]/25 p-3 text-sm text-[#625e55] sm:p-5">
        You are out of the game. You can continue to observe each phase and its results.
      </div>
    );
  }

  const actionDisabled = gameAction.isSubmissionBlocked || isPhaseExpired;
  const nominatedParticipant = find(
    snapshot.public.participants,
    (participant) => participant.id === snapshot.public.nominatedParticipantId,
  );

  return match(snapshot.public.phase)
    .with('discussion', () => (
      <div className="flex shrink-0 flex-col">
        <DiscussionTimeControls
          phaseDeadline={snapshot.public.phaseDeadline}
          sessionId={sessionId}
        />
        <PublicSpeechForm disabled={actionDisabled} gameAction={gameAction} />
      </div>
    ))
    .with('nomination', () => (
      <div className="shrink-0 p-3 sm:p-5">
        <h3 className="text-base font-medium">Choose a nominee</h3>
        <p className="mt-1 text-sm text-[#625e55]">
          Select an alive participant from the participant list.
        </p>
      </div>
    ))
    .with('final-defence', () => {
      const isCurrentParticipantNominated =
        snapshot.public.nominatedParticipantId === snapshot.personal.participantId;
      return (
        <div className="shrink-0">
          <div className={cn('p-3 sm:p-5', isCurrentParticipantNominated && 'pb-0 sm:pb-0')}>
            <h3 className="text-base font-medium">Final defence</h3>
            <p className="mt-1 text-sm text-[#625e55]">
              {nominatedParticipant
                ? `${nominatedParticipant.name} is nominated and has the floor.`
                : 'The nominated participant is preparing a final defence.'}
            </p>
          </div>
          {isCurrentParticipantNominated ? (
            <FinalDefenceForm disabled={actionDisabled} gameAction={gameAction} />
          ) : null}
        </div>
      );
    })
    .with('verdict', () => (
      <VerdictControls
        disabled={actionDisabled}
        nominatedParticipantName={nominatedParticipant?.name}
        personalVote={snapshot.personal.vote}
        gameAction={gameAction}
      />
    ))
    .with('night', () => (
      <div className="shrink-0 p-3 sm:p-5">
        <h3 className="text-base font-medium">
          {match(snapshot.personal.role)
            .with('Mafia', () => 'Choose a target')
            .with('Doctor', () => 'Choose someone to protect')
            .with('Detective', () => 'Choose someone to investigate')
            .with('Citizen', () => 'Night actions are private')
            .exhaustive()}
        </h3>
        <p className="mt-1 text-sm text-[#625e55]">
          {snapshot.personal.role === 'Citizen'
            ? 'Wait for dawn.'
            : 'Select an alive participant from the participant list.'}
        </p>
      </div>
    ))
    .exhaustive();
}
