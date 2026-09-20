import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';

import { MafiaGameSessionClient } from '../../api/client';
import { gameSessionMutationOptions } from '../options/game-session-mutation-options';
import { useCooldown } from '../ui/use-cooldown';

type DiscussionTimeAdjustmentSeconds = 10 | -10;
const discussionTimeAdjustmentCooldownMs = 1_000;

export function useDiscussionTimeAdjustment(expectedDeadline: string) {
  const cooldown = useCooldown();
  const client = new MafiaGameSessionClient();
  const { isPending, mutate } = useMutation(
    gameSessionMutationOptions({
      mutationFn: ({
        adjustmentSeconds,
        idempotencyKey,
      }: {
        adjustmentSeconds: DiscussionTimeAdjustmentSeconds;
        idempotencyKey: string;
      }) => client.adjustDiscussionTime(adjustmentSeconds, expectedDeadline, idempotencyKey),
      onRateLimited: cooldown.startCooldown,
      onSuccess: () => cooldown.startCooldown(discussionTimeAdjustmentCooldownMs),
    }),
  );
  const isSubmissionBlocked = isPending || cooldown.isCoolingDown;

  const adjust = useCallback(
    (adjustmentSeconds: DiscussionTimeAdjustmentSeconds) => {
      if (isSubmissionBlocked) {
        return;
      }

      mutate({
        adjustmentSeconds,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    [isSubmissionBlocked, mutate],
  );

  const adjustMinus10 = useCallback(() => adjust(-10), [adjust]);
  const adjustPlus10 = useCallback(() => adjust(10), [adjust]);

  return {
    isSubmissionBlocked,
    retryAfterSeconds: cooldown.retryAfterSeconds,
    adjustMinus10,
    adjustPlus10,
  };
}
