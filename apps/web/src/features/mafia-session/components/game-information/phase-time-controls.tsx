import { Button } from '@repo/ui/components/button';
import { MinusIcon, PlusIcon } from 'lucide-react';

import type { MafiaGameProjection } from '../../api/client';
import { usePhaseTimeAdjustment } from '../../hooks/use-phase-time-adjustment';

type PhaseTimeControlsProps = {
  sessionId: string;
  phase: Exclude<MafiaGameProjection['public']['phase'], 'completed'>;
  phaseDeadline: string;
};

export function PhaseTimeControls({ sessionId, phase, phaseDeadline }: PhaseTimeControlsProps) {
  const phaseTimeAdjustment = usePhaseTimeAdjustment(sessionId, phase, phaseDeadline);
  const disabled = phaseTimeAdjustment.isPending || phaseTimeAdjustment.isCoolingDown;
  const cooldownLabel = phaseTimeAdjustment.retryAfterSeconds
    ? ` Available again in ${phaseTimeAdjustment.retryAfterSeconds} seconds.`
    : '';

  return (
    <div className="flex items-center gap-1" aria-label="Phase time controls">
      <Button
        aria-label={`Remove 10 seconds from the phase timer.${cooldownLabel}`}
        disabled={disabled}
        onClick={phaseTimeAdjustment.adjustMinus10}
        size="xs"
        type="button"
        variant="outline"
      >
        <MinusIcon data-icon="inline-start" />
        10s
      </Button>
      <Button
        aria-label={`Add 10 seconds to the phase timer.${cooldownLabel}`}
        disabled={disabled}
        onClick={phaseTimeAdjustment.adjustPlus10}
        size="xs"
        type="button"
        variant="outline"
      >
        <PlusIcon data-icon="inline-start" />
        10s
      </Button>
    </div>
  );
}
