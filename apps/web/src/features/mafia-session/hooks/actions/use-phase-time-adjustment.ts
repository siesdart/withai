import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';

import { type MafiaGameProjection, MafiaGameSessionClient } from '../../api/client';
import { gameSessionMutationOptions } from '../options/game-session-mutation-options';
import { useCooldown } from '../ui/use-cooldown';

type PhaseTimeAdjustment = 10 | -10;
type ActiveMafiaPhase = Exclude<MafiaGameProjection['public']['phase'], 'completed'>;
const phaseTimeAdjustmentCooldownMs = 1_000;

export function usePhaseTimeAdjustment(
  sessionId: string,
  expectedPhase: ActiveMafiaPhase,
  expectedPhaseDeadline: string,
) {
  const cooldown = useCooldown();
  const client = new MafiaGameSessionClient(sessionId);
  const { isPending, mutate } = useMutation(
    gameSessionMutationOptions({
      sessionId,
      mutationFn: ({
        adjustmentSeconds,
        expectedPhase: requestPhase,
        expectedPhaseDeadline: requestPhaseDeadline,
        idempotencyKey,
      }: {
        adjustmentSeconds: PhaseTimeAdjustment;
        expectedPhase: ActiveMafiaPhase;
        expectedPhaseDeadline: string;
        idempotencyKey: string;
      }) =>
        client.adjustPhaseTime(
          adjustmentSeconds,
          requestPhase,
          requestPhaseDeadline,
          idempotencyKey,
        ),
      onRateLimited: cooldown.startCooldown,
      onSuccess: () => cooldown.startCooldown(phaseTimeAdjustmentCooldownMs),
    }),
  );

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
