/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- each rendered Participant needs a bound Nomination intent. */
import { Button } from '@repo/ui/components/button';
import { filter, map, pipe } from 'remeda';

import type { MafiaGameProjection } from '../../api/client';

type NominationControlsProps = {
  disabled: boolean;
  participants: MafiaGameProjection['public']['participants'];
  personalVote: MafiaGameProjection['personal']['vote'];
  onNominate: (participantId: string) => void;
};

export function NominationControls({
  disabled,
  participants,
  personalVote,
  onNominate,
}: NominationControlsProps) {
  const participantNames = new Map(
    map(participants, (participant) => [participant.id, participant.name]),
  );

  return (
    <div className="flex shrink-0 flex-col gap-3 p-3 sm:p-5">
      <div>
        <h3 className="text-base font-medium">Choose a nominee</h3>
        <p className="mt-1 text-sm text-[#625e55]">
          {personalVote?.phase === 'nomination'
            ? `Your current nomination is ${participantNames.get(personalVote.targetParticipantId) ?? 'recorded'}. You can change it until the deadline.`
            : 'Nominate one living participant for final defence. You can change your choice until the deadline.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {pipe(
          participants,
          filter((participant) => participant.alive),
          map((participant) => (
            <Button
              key={participant.id}
              disabled={disabled}
              onClick={() => onNominate(participant.id)}
              type="button"
              variant={
                personalVote?.phase === 'nomination' &&
                personalVote.targetParticipantId === participant.id
                  ? 'default'
                  : 'outline'
              }
            >
              Nominate {participant.name}
            </Button>
          )),
        )}
      </div>
    </div>
  );
}
