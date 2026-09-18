import type { MafiaGameProjection } from '@repo/mafia/client';
import { cn } from 'cn';

export function ParticipantItem({
  currentParticipantId,
  participant,
}: {
  currentParticipantId: string;
  participant: MafiaGameProjection['public']['participants'][number];
}) {
  return (
    <div className="flex h-5 w-full min-w-0 items-center">
      <span
        className={cn(
          'min-w-0 truncate text-sm',
          !participant.alive && 'text-[#a43b31] line-through',
        )}
      >
        {participant.name}
      </span>
      {participant.id === currentParticipantId ? (
        <span className="ml-1 text-xs text-[#625e55]">(you)</span>
      ) : null}
    </div>
  );
}
