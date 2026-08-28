import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { type MafiaGameProjection, MafiaGameSessionClient } from '../api/client';
import { isGameSessionApiError } from '../api/error';
import { useCooldown } from './use-cooldown';
import { gameSessionSnapshotOptions } from './use-game-session-snapshot';

type PhaseTimeAdjustment = 10 | -10;
type ActiveMafiaPhase = Exclude<MafiaGameProjection['public']['phase'], 'completed'>;

export function usePhaseTimeAdjustment(
  sessionId: string,
  expectedPhase: ActiveMafiaPhase,
  expectedPhaseDeadline: string,
) {
  const queryClient = useQueryClient();
  const cooldown = useCooldown();
  const client = new MafiaGameSessionClient(sessionId);
  const { isPending, mutate } = useMutation({
    mutationFn: async ({
      adjustmentSeconds,
      expectedPhase: requestPhase,
      expectedPhaseDeadline: requestPhaseDeadline,
      idempotencyKey,
    }: {
      adjustmentSeconds: PhaseTimeAdjustment;
      expectedPhase: ActiveMafiaPhase;
      expectedPhaseDeadline: string;
      idempotencyKey: string;
    }) => {
      const result = await client.adjustPhaseTime(
        adjustmentSeconds,
        requestPhase,
        requestPhaseDeadline,
        idempotencyKey,
      );
      return result.match(
        (projection) => projection,
        (error) => {
          throw error;
        },
      );
    },
    onSuccess: (projection) => {
      queryClient.setQueryData(gameSessionSnapshotOptions(sessionId).queryKey, projection);
    },
    onError: (error) => {
      if (isGameSessionApiError(error) && error.type === 'rate-limited') {
        cooldown.startCooldown(error.retryAfterMs);
      }
    },
  });

  const adjust = useCallback(
    (adjustmentSeconds: PhaseTimeAdjustment) => {
      if (isPending || cooldown.isCoolingDown) {
        return;
      }

      mutate({
        adjustmentSeconds,
        expectedPhase,
        expectedPhaseDeadline,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    [cooldown.isCoolingDown, expectedPhase, expectedPhaseDeadline, isPending, mutate],
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
