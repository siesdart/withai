import type { MafiaGameProjection } from '@repo/mafia/client';
import { Button } from '@repo/ui/components/button';
import { useCallback } from 'react';

import type { UseGameActionResult } from '../../hooks/actions/use-game-action';

type VerdictControlsProps = {
  disabled: boolean;
  nominatedParticipantName: string | undefined;
  personalVote: MafiaGameProjection['personal']['vote'];
  gameAction: UseGameActionResult;
};

export function VerdictControls({
  disabled,
  nominatedParticipantName,
  personalVote,
  gameAction,
}: VerdictControlsProps) {
  const eliminate = useCallback(
    () => gameAction.submit({ type: 'verdict', vote: 'eliminate' }),
    [gameAction],
  );
  const spare = useCallback(
    () => gameAction.submit({ type: 'verdict', vote: 'spare' }),
    [gameAction],
  );

  return (
    <div className="flex shrink-0 flex-col gap-3 p-3 sm:p-5">
      <h3 className="text-base font-medium">
        Verdict for {nominatedParticipantName ?? 'the nominee'}
      </h3>
      <div className="flex gap-2">
        <Button
          disabled={disabled}
          onClick={eliminate}
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
          onClick={spare}
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
