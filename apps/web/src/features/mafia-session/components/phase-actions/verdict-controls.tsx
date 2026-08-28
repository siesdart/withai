/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- each button binds one explicit Verdict intent. */
import { Button } from '@repo/ui/components/button';

import type { MafiaGameProjection } from '../../api/client';

type VerdictControlsProps = {
  disabled: boolean;
  nominatedParticipantName: string | undefined;
  personalVote: MafiaGameProjection['personal']['vote'];
  onSubmitVerdict: (vote: 'eliminate' | 'spare') => void;
};

export function VerdictControls({
  disabled,
  nominatedParticipantName,
  personalVote,
  onSubmitVerdict,
}: VerdictControlsProps) {
  return (
    <div className="flex shrink-0 flex-col gap-3 p-3 sm:p-5">
      <div>
        <h3 className="text-base font-medium">
          Verdict for {nominatedParticipantName ?? 'the nominee'}
        </h3>
        <p className="mt-1 text-sm text-[#625e55]">
          {personalVote?.phase === 'verdict'
            ? `Your current verdict is ${personalVote.vote}. You can change it until the deadline.`
            : 'Choose whether to eliminate or spare the nominated participant.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={disabled}
          onClick={() => onSubmitVerdict('eliminate')}
          type="button"
          variant={
            personalVote?.phase === 'verdict' && personalVote.vote === 'eliminate'
              ? 'default'
              : 'outline'
          }
        >
          Eliminate
        </Button>
        <Button
          disabled={disabled}
          onClick={() => onSubmitVerdict('spare')}
          type="button"
          variant={
            personalVote?.phase === 'verdict' && personalVote.vote === 'spare'
              ? 'default'
              : 'outline'
          }
        >
          Spare
        </Button>
      </div>
    </div>
  );
}
