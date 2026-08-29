import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';

import { MafiaGameSessionClient } from '../../api/client';
import { gameSessionMutationOptions } from '../options/game-session-mutation-options';
import { useCooldown } from '../ui/use-cooldown';

type DiscussionTimeAdjustmentSeconds = 10 | -10;
const discussionTimeAdjustmentCooldownMs = 1_000;

export function useDiscussionTimeAdjustment(sessionId: string, expectedDeadline: string) {
  const cooldown = useCooldown();
  const client = new MafiaGameSessionClient(sessionId);
  const { isPending, mutate } = useMutation(
    gameSessionMutationOptions({
      sessionId,
      mutationFn: ({
        adjustmentSeconds,
        expectedDeadline: requestDeadline,
        idempotencyKey,
      }: {
        adjustmentSeconds: DiscussionTimeAdjustmentSeconds;
        expectedDeadline: string;
        idempotencyKey: string;
      }) => client.adjustDiscussionTime(adjustmentSeconds, requestDeadline, idempotencyKey),
      onRateLimited: cooldown.startCooldown,
      onSuccess: () => cooldown.startCooldown(discussionTimeAdjustmentCooldownMs),
    }),
  );

  const adjust = useCallback(
    (adjustmentSeconds: DiscussionTimeAdjustmentSeconds) => {
      if (isPending || cooldown.isCoolingDown) {
        return;
      }

      mutate({
        adjustmentSeconds,
        expectedDeadline,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    [cooldown.isCoolingDown, expectedDeadline, isPending, mutate],
  );

  const adjustMinus10 = useCallback(() => adjust(-10), [adjust]);
  const adjustPlus10 = useCallback(() => adjust(10), [adjust]);

  return {
    isCoolingDown: cooldown.isCoolingDown,
    isPending,
    retryAfterSeconds: cooldown.retryAfterSeconds,
    adjustMinus10,
    adjustPlus10,
  };
}
