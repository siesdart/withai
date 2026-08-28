import { match } from 'ts-pattern';

import type { MafiaGameProjection } from '../../api/api';
import type { UsePublicSpeechResult } from '../../hooks/use-public-speech';
import { FinalDefenceForm } from './final-defence-form';
import { NominationControls } from './nomination-controls';
import { PublicSpeechComposer } from './public-speech-composer';
import { VerdictControls } from './verdict-controls';

type PhaseActionPanelProps = {
  currentParticipantId: string;
  currentParticipantAlive: boolean;
  isPhaseExpired: boolean;
  personalVote: MafiaGameProjection['personal']['vote'];
  publicInformation: MafiaGameProjection['public'];
  speech: UsePublicSpeechResult;
  isSubmittingAction: boolean;
  onNominate: (participantId: string) => void;
  onSubmitFinalDefence: (content: string) => void;
  onSubmitVerdict: (vote: 'eliminate' | 'spare') => void;
};

export function PhaseActionPanel({
  currentParticipantId,
  currentParticipantAlive,
  isPhaseExpired,
  personalVote,
  publicInformation,
  speech,
  isSubmittingAction,
  onNominate,
  onSubmitFinalDefence,
  onSubmitVerdict,
}: PhaseActionPanelProps) {
  if (publicInformation.phase === 'completed') {
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

  const actionDisabled = isSubmittingAction || isPhaseExpired;
  const nominatedParticipant = publicInformation.participants.find(
    (participant) => participant.id === publicInformation.nominatedParticipantId,
  );

  return match(publicInformation.phase)
    .with('day-discussion', () => (
      <PublicSpeechComposer disabled={actionDisabled} speech={speech} />
    ))
    .with('nomination', () => (
      <NominationControls
        disabled={actionDisabled}
        onNominate={onNominate}
        participants={publicInformation.participants}
        personalVote={personalVote}
      />
    ))
    .with('final-defence', () => (
      <div className="shrink-0 p-3 sm:p-5">
        <h3 className="text-base font-medium">Final defence</h3>
        <p className="mt-1 text-sm text-[#625e55]">
          {nominatedParticipant
            ? `${nominatedParticipant.name} is nominated and has the floor.`
            : 'The nominated participant is preparing a final defence.'}
        </p>
        {publicInformation.nominatedParticipantId === currentParticipantId ? (
          <FinalDefenceForm disabled={actionDisabled} onSubmitFinalDefence={onSubmitFinalDefence} />
        ) : null}
      </div>
    ))
    .with('verdict', () => (
      <VerdictControls
        disabled={actionDisabled}
        nominatedParticipantName={nominatedParticipant?.name}
        onSubmitVerdict={onSubmitVerdict}
        personalVote={personalVote}
      />
    ))
    .exhaustive();
}
