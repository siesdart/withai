import type { MafiaGameProjection } from '@repo/mafia/client';
import { cn } from 'cn';
import { TimerIcon } from 'lucide-react';

import type { UseDeadlineCountdownResult } from '../../hooks/ui/use-deadline-countdown';
import { useGameTranslation } from '../../i18n/use-game-translation';

type GamePhaseTimerProps = {
  phase: MafiaGameProjection['public']['phase'];
  deadline: UseDeadlineCountdownResult;
};

export function GamePhaseTimer({ phase, deadline }: GamePhaseTimerProps) {
  const { t } = useGameTranslation();
  if (phase === 'completed') return null;

  return (
    <div className="ml-auto flex shrink-0 flex-nowrap items-center gap-x-2 text-xs text-current sm:gap-x-4">
      <div className="flex shrink-0 items-center gap-1.5" aria-live="polite">
        <TimerIcon
          aria-hidden="true"
          className={cn('size-3.5', deadline.isUrgent && 'text-[#a43b31]')}
        />
        <span
          className={cn('whitespace-nowrap tabular-nums', deadline.isUrgent && 'text-[#a43b31]')}
        >
          {deadline.isExpired ? t('timer.resolving') : deadline.label}
        </span>
      </div>
    </div>
  );
}
