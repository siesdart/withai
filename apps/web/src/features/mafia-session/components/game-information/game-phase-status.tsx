import { Badge } from '@repo/ui/components/badge';
import { TimerIcon } from 'lucide-react';
import { match } from 'ts-pattern';

import type { MafiaGameProjection } from '../../api/client';

type GamePhaseStatusProps = {
  dayNumber: number;
  phase: MafiaGameProjection['public']['phase'];
  deadline: { label: string; isExpired: boolean; isUrgent: boolean };
};

const phaseCopy = (phase: GamePhaseStatusProps['phase']) =>
  match(phase)
    .with('day-discussion', () => ({
      title: 'Public discussion',
      detail: 'Share your read before voting opens.',
    }))
    .with('nomination', () => ({
      title: 'Nomination',
      detail: 'Choose one living participant for final defence.',
    }))
    .with('final-defence', () => ({
      title: 'Final defence',
      detail: 'Hear the nominated participant before the verdict.',
    }))
    .with('verdict', () => ({
      title: 'Verdict',
      detail: 'Vote to eliminate or spare the nominated participant.',
    }))
    .with('completed', () => ({
      title: 'Game complete',
      detail: 'The full vote record is now available.',
    }))
    .exhaustive();

export function GamePhaseStatus({ dayNumber, phase, deadline }: GamePhaseStatusProps) {
  const copy = phaseCopy(phase);
  const deadlineLabel = deadline.isExpired ? 'Resolving result' : `Deadline in ${deadline.label}`;

  return (
    <section
      className="relative min-w-0 gap-3 border-b-2 border-[#22221e] pb-3 sm:pb-5"
      aria-labelledby="phase-title"
    >
      <p className="text-xs tracking-[0.24em] text-[#625e55] uppercase">WithAI / Mafia</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 id="phase-title" className="text-xl font-semibold sm:text-2xl">
          Day {dayNumber} / {copy.title}
        </h1>
        <Badge variant={phase === 'completed' ? 'secondary' : 'outline'}>
          {phase === 'completed' ? 'Complete' : 'Live phase'}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-[#625e55] sm:text-sm">{copy.detail}</p>
      {phase !== 'completed' ? (
        <div
          className="absolute top-0 right-0 flex shrink-0 items-center gap-1.5 text-xs text-[#625e55] sm:gap-2 sm:text-sm"
          aria-live="polite"
        >
          <TimerIcon
            aria-hidden="true"
            className={deadline.isUrgent ? 'size-4 text-[#a43b31]' : 'size-4'}
          />
          <span
            className={
              deadline.isUrgent
                ? 'font-semibold whitespace-nowrap text-[#a43b31]'
                : 'whitespace-nowrap'
            }
          >
            {deadlineLabel}
          </span>
        </div>
      ) : null}
    </section>
  );
}
